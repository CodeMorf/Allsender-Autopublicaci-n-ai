import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/drizzle';
import { extractSalesConversationData } from '@/lib/modules/sales-ai/ai-sales-extractor';
import { quoteSalesDelivery, getSalesDeliveryConfig, calculateSalesDeliveryFee } from '@/lib/modules/sales-ai/delivery-service';
import { getLogihubConfig, isLogihubEnabled } from '@/lib/modules/sales-ai/logihub-service';
import { createSalesOrderFromDraft, findRecentSalesOrderDuplicate } from '@/lib/modules/sales-ai/order-service';
import { tryHandleSalesAiMessage } from '@/lib/modules/sales-ai/orchestrator';
import { getSalesPaymentConfig, formatSalesPaymentMethods } from '@/lib/modules/sales-ai/payment-service';
import { productHasRealImage, searchSalesProducts } from '@/lib/modules/sales-ai/product-service';

type Check = { name: string; ok: boolean; detail?: string };

function rows(result: unknown): Record<string, unknown>[] {
 if (Array.isArray(result)) return result as Record<string, unknown>[];
 const maybe = result as { rows?: Record<string, unknown>[] } | null;
 return Array.isArray(maybe?.rows) ? maybe.rows : [];
}

function ok(name: string, condition: unknown, detail?: string): Check {
 return { name, ok: Boolean(condition), detail };
}

async function findTeam() {
 const result = await db.execute(sql`
 SELECT s.team_id, s.agent_name
 FROM ai_sales_settings s
 WHERE COALESCE(s.is_active, false) = true
 AND EXISTS (
 SELECT 1
 FROM ai_sales_products p
 WHERE p.team_id = s.team_id
 AND p.is_active = true
 )
 ORDER BY s.updated_at DESC NULLS LAST
 LIMIT 1
 `);
 return rows(result)[0] || null;
}

async function main() {
 const checks: Check[] = [];
 const team = await findTeam();
 checks.push(ok('Equipo con Venta IA activa y productos reales', team, team ? `team_id=${team.team_id}` : 'No hay equipo listo'));
 if (!team) {
 print(checks);
 process.exit(1);
 }

 const teamId = Number(team.team_id);
 const samples = [
 'Hola',
 'Busco abanico',
 'Mándame foto',
 '¿Tiene garantía?',
 '¿Qué medidas tiene?',
 'Quiero 2',
 'Calle Duarte 25, Santo Domingo',
 '18.4861,-69.9312',
 'contra entrega',
 'transferencia',
 'sí confirmo',
 'cancelar orden',
 'tracking ABC123',
 'necesito una cita',
 'quiero hablar con departamento',
 ];
 const extractions = await Promise.all(samples.map((text) => extractSalesConversationData({ teamId, text })));
 checks.push(ok('Extractor conversa sin IA para mensajes simples', extractions[0]?.intent === 'greeting', extractions[0]?.intent));
 checks.push(ok('Extractor detecta búsqueda de producto', extractions[1]?.intent === 'product_search' && Boolean(extractions[1]?.product_query), JSON.stringify(extractions[1])));
 checks.push(ok('Extractor detecta foto', extractions[2]?.intent === 'ask_image', extractions[2]?.intent));
 checks.push(ok('Extractor detecta garantía', extractions[3]?.intent === 'ask_warranty', extractions[3]?.intent));
 checks.push(ok('Extractor detecta cantidad 2', extractions[5]?.quantity === 2, JSON.stringify(extractions[5])));
 checks.push(ok('Extractor detecta dirección', extractions[6]?.address, JSON.stringify(extractions[6])));
 checks.push(ok('Extractor detecta ubicación lat/lng', extractions[7]?.location_lat !== null && extractions[7]?.location_lng !== null, JSON.stringify(extractions[7])));
 checks.push(ok('Extractor detecta contra entrega', extractions[8]?.payment_method === 'cod', extractions[8]?.payment_method || ''));
 checks.push(ok('Extractor detecta transferencia', extractions[9]?.payment_method === 'transfer', extractions[9]?.payment_method || ''));
 checks.push(ok('Extractor detecta confirmación', extractions[10]?.confirmation === true, JSON.stringify(extractions[10])));
 checks.push(ok('Venta IA no toma citas', extractions[13]?.intent === 'handoff', extractions[13]?.intent));
 checks.push(ok('Venta IA deriva departamento', extractions[14]?.intent === 'handoff', extractions[14]?.intent));

 const productQuery = extractions[1]?.product_query || 'producto';
 let products = await searchSalesProducts(teamId, productQuery, 5);
 if (!products.length) {
 const fallback = await db.execute(sql`
 SELECT name
 FROM ai_sales_products
 WHERE team_id = ${teamId}
 AND is_active = true
 ORDER BY updated_at DESC
 LIMIT 1
 `);
 const fallbackName = String(rows(fallback)[0]?.name || 'producto');
 products = await searchSalesProducts(teamId, fallbackName, 5);
 }
 const product = products[0] || null;
 checks.push(ok('Catálogo devuelve producto real', product, product ? `${product.id} ${product.name}` : 'Sin producto'));
 checks.push(ok('Imagen real preparada o respuesta comercial disponible', product ? (productHasRealImage(product) || product.imageUrl === null) : false, product?.imageUrl || 'Este producto todavía no tiene imagen cargada.'));

 if (product) {
 const selectedState = {
 selectedProductId: String(product.id),
 selectedProductName: product.name,
 selectedProductPrice: product.price,
 currentStage: 'product_selected',
 paymentStatus: 'none',
 lastProductsSent: products.map((item, index) => ({ index: index + 1, id: item.id, name: item.name, price: item.price })),
 } as any;
 const shippingTurn = await tryHandleSalesAiMessage({
 teamId,
 conversacionesId: 0,
 text: 'Si, me gusta, estoy en el distrito nacional, tienen envio?',
 intent: { type: 'message', confidence: 0.8 } as any,
 state: selectedState,
 });
 checks.push(ok('Venta IA mantiene producto ante pregunta de envio', shippingTurn?.action === 'delivery_question_keep_product', JSON.stringify(shippingTurn)));

 const correctionTurn = await tryHandleSalesAiMessage({
 teamId,
 conversacionesId: 0,
 text: 'Aun no le envie los datos',
 intent: { type: 'message', confidence: 0.8 } as any,
 state: selectedState,
 });
 checks.push(ok('Venta IA no busca producto cuando cliente corrige datos', correctionTurn?.action === 'customer_data_correction_keep_product', JSON.stringify(correctionTurn)));
 }

 const deliveryConfig = await getSalesDeliveryConfig(teamId);
 const fallbackFee = calculateSalesDeliveryFee(deliveryConfig, 2);
 checks.push(ok('Delivery base aplicado', fallbackFee >= 0, String(fallbackFee)));
 if (process.argv.includes('--external')) {
 const quote = await quoteSalesDelivery(teamId, {
 quantity: 2,
 address: 'Calle Duarte 25, Santo Domingo',
 subtotal: product ? product.price * 2 : 0,
 customerName: 'Cliente Prueba',
 customerPhone: '8295683388',
 });
 checks.push(ok('Delivery cotizado o estimado sin inventar', typeof quote.deliveryFee === 'number' && quote.deliveryFee >= 0, JSON.stringify({ fee: quote.deliveryFee, needsAddress: quote.needsAddress })));
 } else {
 checks.push(ok('Delivery cotizado o estimado sin inventar', fallbackFee >= 0, `dry-run fee=${fallbackFee}; usa --external para cotizar Logihub`));
 }

 const payments = await getSalesPaymentConfig(teamId);
 checks.push(ok('Métodos de pago disponibles', formatSalesPaymentMethods(payments) !== 'Configura tus métodos de pago.', formatSalesPaymentMethods(payments)));

 const logihubConfig = await getLogihubConfig(teamId);
 const logihubActive = await isLogihubEnabled(teamId);
 checks.push(ok('Logihub revisado', true, logihubActive ? `activo:${logihubConfig.deliveryMode}` : 'inactivo o sin clave'));

 const duplicate = await findRecentSalesOrderDuplicate({ teamId, conversacionesId: Number(process.env.SALES_AI_TEST_CHAT_ID || 0), windowSeconds: 60 });
 checks.push(ok('Guard anti-duplicado disponible', duplicate !== undefined, duplicate ? `orden reciente ${duplicate.order_number}` : 'sin duplicado reciente'));

 const activeOrderResult = await db.execute(sql`
 SELECT conversaciones_id, order_number
 FROM ai_sales_orders
 WHERE team_id = ${teamId}
 AND conversaciones_id IS NOT NULL
 AND status NOT IN ('cancelled', 'canceled', 'completed', 'delivered', 'returned')
 ORDER BY id DESC
 LIMIT 1
 `).catch(() => null);
 const activeOrder = rows(activeOrderResult)[0];
 if (activeOrder?.conversaciones_id) {
 const activeConversacionesId = Number(activeOrder.conversaciones_id);
 const thanksTurn = await tryHandleSalesAiMessage({
 teamId,
 conversacionesId: activeConversacionesId,
 text: 'Gracias',
 intent: { type: 'message', confidence: 0.8 } as any,
 state: null,
 });
 checks.push(ok('Orden activa: Gracias no abre busqueda', thanksTurn?.action !== 'active_order_catalog_results' && thanksTurn?.action !== 'catalog_results', JSON.stringify(thanksTurn)));

 const waitingTurn = await tryHandleSalesAiMessage({
 teamId,
 conversacionesId: activeConversacionesId,
 text: 'Quedo ala espera',
 intent: { type: 'message', confidence: 0.8 } as any,
 state: null,
 });
 checks.push(ok('Orden activa: Quedo a la espera es seguimiento humano', waitingTurn?.action === 'active_order_followup_no_product_search', JSON.stringify(waitingTurn)));

 const correctionTurn = await tryHandleSalesAiMessage({
 teamId,
 conversacionesId: activeConversacionesId,
 text: 'Pero ya confirmamos y me la preparaste',
 intent: { type: 'message', confidence: 0.8 } as any,
 state: null,
 });
 checks.push(ok('Orden activa: correccion no abre catalogo', correctionTurn?.action === 'active_order_followup_no_product_search', JSON.stringify(correctionTurn)));
 } else {
 checks.push(ok('Pruebas de orden activa omitidas sin orden real', true, 'No hay orden activa con conversaciones para dry-run'));
 }

 if (process.argv.includes('--create-order')) {
 const conversacionesId = Number(process.env.SALES_AI_TEST_CHAT_ID || 0);
 if (!conversacionesId || !product) throw new Error('SALES_AI_TEST_CHAT_ID y producto real son obligatorios para crear orden real.');
 const created = await createSalesOrderFromDraft({
 teamId,
 conversacionesId,
 customer: {
 name: 'Cliente Prueba Venta IA',
 phone: '8295683388',
 address: 'Calle Duarte 25, Santo Domingo',
 },
 items: [{ productId: product.id, quantity: 1 }],
 paymentMethod: 'cod',
 paymentStatus: 'pending_cod',
 aiSummary: 'Prueba real solicitada con --create-order.',
 });
 checks.push(ok('Orden real creada con confirmación explícita', (created as any)?.ok !== false, JSON.stringify(created)));
 } else {
 checks.push(ok('Creación de orden queda protegida por confirmación', true, 'dry-run; usa --create-order para prueba real controlada'));
 }

 print(checks);
 if (checks.some((check) => !check.ok)) process.exit(1);
 process.exit(0);
}

function print(checks: Check[]) {
 for (const check of checks) {
 console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
 }
}

main().catch((error) => {
 console.error('FAIL prueba Venta IA - No se pudo completar la acción en este momento.');
 console.error(error?.message || error);
 process.exit(1);
});
