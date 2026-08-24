-- AllSender Ventas IA V19 - Agente IA orquestado
-- No requiere cambios de esquema.
-- El cambio es de código: clasificador determinístico + guardas contra búsqueda automática de productos.
-- Aplicar después de V18 si aún no se aplicó la migración de cuentas bancarias / LogiHub.

SELECT 'sales_ai_agent_orchestrator_v19_no_schema_change' AS migration;
