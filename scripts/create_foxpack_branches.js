
const fs = require('fs');
const { Pool } = require('pg');
const branches = [{"name": "BELLA VISTA", "code": "bella-vista", "location_text": "Dr. Fernando Defillo #2 1er Nivel Local 102 Fox Plaza (Casi Esq. Romulo B.)", "keywords": ["bella", "vista", "santo domingo", "fox plaza", "defillo", "romulo", "bella vista sd", "foxpack", "fox pack", "fox"], "order_index": 1, "delivery_only": false, "phone": "809-681-6002 Ext: 300", "city": "Santo Domingo", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 300", "city": "Santo Domingo", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "EL CLARET (Solo Delivery)", "code": "el-claret-solo-delivery", "location_text": "Euclides Morillo #86 Sector El Claret., Frente a la Iglesia Divina Misericordia", "keywords": ["claret", "delivery", "santo domingo", "euclides morillo", "divina misericordia", "solo delivery claret", "solo delivery", "domicilio", "foxpack", "fox pack", "fox"], "order_index": 2, "delivery_only": true, "phone": "809-681-6002 Ext: 310", "city": "Santo Domingo", "notes": "Solo Delivery", "metadata": {"phone": "809-681-6002 Ext: 310", "city": "Santo Domingo", "delivery_only": true, "notes": "Solo Delivery", "source": "bulk_import_foxpack"}}, {"name": "ENSANCHE LUPERON", "code": "ensanche-luperon", "location_text": "Albert Thomas #254, Ensanche Luperon, Santo Domingo", "keywords": ["ensanche", "luperon", "santo domingo", "albert thomas", "ensanche luperon", "luperón", "foxpack", "fox pack", "fox"], "order_index": 3, "delivery_only": false, "phone": "809-681-6002 Ext: 304", "city": "Santo Domingo", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 304", "city": "Santo Domingo", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "VILLA MELLA / SANTA CRUZ", "code": "villa-mella-santa-cruz", "location_text": "Plaza Ohana, Av. Hermanas Mirabal No. 348, Santa Cruz, Villa Mella", "keywords": ["villa", "mella", "santa", "cruz", "villa mella", "santa cruz", "plaza ohana", "hermanas mirabal", "mirabal", "foxpack", "fox pack", "fox"], "order_index": 4, "delivery_only": false, "phone": "809-681-6002 Ext: 303 / Movil: 809-577-7272", "city": "Villa Mella", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 303 / Movil: 809-577-7272", "city": "Villa Mella", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "SAN ISIDRO (HOTEL GOLDEN)", "code": "san-isidro-hotel-golden", "location_text": "San Isidro, Hotel Golden House", "keywords": ["san", "isidro", "hotel", "golden", "santo domingo este", "san isidro", "golden house", "hotel golden", "foxpack", "fox pack", "fox"], "order_index": 5, "delivery_only": false, "phone": "809-681-6002 Ext: 306", "city": "Santo Domingo Este", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 306", "city": "Santo Domingo Este", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "LAS PALMAS HERRERA", "code": "las-palmas-herrera", "location_text": "Avenida Las Palmas #33 Plaza Serimpreca local comercial B-1 Sector Las Palmas de Herrera, Santo Domingo Oeste", "keywords": ["palmas", "herrera", "santo domingo oeste", "las palmas", "serimpreca", "palmas de herrera", "foxpack", "fox pack", "fox"], "order_index": 6, "delivery_only": false, "phone": "809-681-6002 Ext: 312 / Móvil: 809-627-9179", "city": "Santo Domingo Oeste", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 312 / Móvil: 809-627-9179", "city": "Santo Domingo Oeste", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "LOS MINA (Solo Delivery)", "code": "los-mina-solo-delivery", "location_text": "Av. San Vicente de Paul #171 Los Mina", "keywords": ["mina", "delivery", "santo domingo este", "los mina", "san vicente de paul", "solo delivery mina", "solo delivery", "domicilio", "foxpack", "fox pack", "fox"], "order_index": 7, "delivery_only": true, "phone": "809-681-6002 Ext: 327 / Móvil: 809-896-1082", "city": "Santo Domingo Este", "notes": "Solo Delivery", "metadata": {"phone": "809-681-6002 Ext: 327 / Móvil: 809-896-1082", "city": "Santo Domingo Este", "delivery_only": true, "notes": "Solo Delivery", "source": "bulk_import_foxpack"}}, {"name": "VILLA AURA", "code": "villa-aura", "location_text": "Villa Aura", "keywords": ["villa", "aura", "santo domingo oeste", "villa aura", "foxpack villa aura", "santo domingo oeste aura", "foxpack", "fox pack", "fox"], "order_index": 8, "delivery_only": false, "phone": "809-681-6002 Ext", "city": "Santo Domingo Oeste", "notes": "", "metadata": {"phone": "809-681-6002 Ext", "city": "Santo Domingo Oeste", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "SANTIAGO / 27 FEB - Los Colegios", "code": "santiago-27-feb-los-colegios", "location_text": "AV 27 DE FEBRERO Esq. CALLE CONSTANZA", "keywords": ["santiago", "feb", "colegios", "27 de febrero", "constanza", "los colegios", "santiago 27", "foxpack", "fox pack", "fox"], "order_index": 9, "delivery_only": false, "phone": "809-681-6002 Ext: 400", "city": "Santiago", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 400", "city": "Santiago", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "SANTIAGO (GURABO)", "code": "santiago-gurabo", "location_text": "Gurabo Km 6.5 Santiago, (Frente a Supermercado Valerio)", "keywords": ["santiago", "gurabo", "santiago gurabo", "valerio", "km 6.5", "supermercado valerio", "foxpack", "fox pack", "fox"], "order_index": 10, "delivery_only": false, "phone": "809-681-6002 Ext: 402", "city": "Santiago", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 402", "city": "Santiago", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "SANTIAGO (BELLA TERRA)", "code": "santiago-bella-terra", "location_text": "Bella Terra Mall, Av. Juan Pablo Duarte, Santiago De Los Caballeros", "keywords": ["santiago", "bella", "terra", "bella terra", "santiago bella terra", "juan pablo duarte", "mall bella terra", "santiago mall", "foxpack", "fox pack", "fox"], "order_index": 11, "delivery_only": false, "phone": "809-681-6002 Ext: 401", "city": "Santiago", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 401", "city": "Santiago", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "LA VEGA", "code": "la-vega", "location_text": "Calle Balilo Gómez #2 Casi esq. Imbert, Las Carolinas (Justo al lado del Banreservas de la avenida Imbert) La Vega", "keywords": ["vega", "la vega", "balilo gomez", "imbert", "las carolinas", "banreservas la vega", "foxpack", "fox pack", "fox"], "order_index": 12, "delivery_only": false, "phone": "809-681-6002 Ext: 430 / Cel: 809-242-8199", "city": "La Vega", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 430 / Cel: 809-242-8199", "city": "La Vega", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "MOCA", "code": "moca", "location_text": "Calle 26 de Julio, plaza Hollywood primer nivel.", "keywords": ["moca", "26 de julio", "plaza hollywood", "hollywood moca", "hollywood", "foxpack", "fox pack", "fox"], "order_index": 13, "delivery_only": false, "phone": "809-681-6002 Ext: 431", "city": "Moca", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 431", "city": "Moca", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "BONAO", "code": "bonao", "location_text": "Calle 16 de Agosto, Zoemi's Plaza, Al lado de Senasa.", "keywords": ["bonao", "16 de agosto", "zoemis", "senasa bonao", "monsenor nouel", "foxpack", "fox pack", "fox"], "order_index": 14, "delivery_only": false, "phone": "809-681-6002 Ext: 433 / Móvil: 809-305-7953", "city": "Bonao", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 433 / Móvil: 809-305-7953", "city": "Bonao", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "CASTILLO SFM (SOLO DELIVERY)", "code": "castillo-sfm-solo-delivery", "location_text": "Calle: Plaza Local #202, Frente al Parque", "keywords": ["castillo", "sfm", "delivery", "castillo sfm", "san francisco castillo", "solo delivery castillo", "parque castillo", "solo delivery", "domicilio", "foxpack", "fox pack", "fox"], "order_index": 15, "delivery_only": true, "phone": "809-681-6002", "city": "Castillo", "notes": "Solo Delivery", "metadata": {"phone": "809-681-6002", "city": "Castillo", "delivery_only": true, "notes": "Solo Delivery", "source": "bulk_import_foxpack"}}, {"name": "SAN FRANCISCO (Solo Delivery)", "code": "san-francisco-solo-delivery", "location_text": "Plaza Garden, Av Fernández Antonio Fernández (frente a la bomba Texaco Javier)", "keywords": ["san", "francisco", "delivery", "san francisco de macorís", "san francisco", "sfm", "plaza garden", "texaco javier", "solo delivery sfm", "macoris", "solo delivery", "domicilio", "foxpack", "fox pack", "fox"], "order_index": 16, "delivery_only": true, "phone": "809-681-6002 Ext: 322 / WhatsApp: 829-633-8272", "city": "San Francisco de Macorís", "notes": "Solo Delivery", "metadata": {"phone": "809-681-6002 Ext: 322 / WhatsApp: 829-633-8272", "city": "San Francisco de Macorís", "delivery_only": true, "notes": "Solo Delivery", "source": "bulk_import_foxpack"}}, {"name": "NAGUA", "code": "nagua", "location_text": "Centro Comercial Empire Place, Calle Altagracia Esq. Gregorio Luperon", "keywords": ["nagua", "empire place", "altagracia nagua", "gregorio luperon nagua", "maria trinidad sanchez", "foxpack", "fox pack", "fox"], "order_index": 17, "delivery_only": false, "phone": "809-681-6002 Ext: 333", "city": "Nagua", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 333", "city": "Nagua", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "FANTINO", "code": "fantino", "location_text": "Calle Jaime Vargas No. 50, Centro de la ciudad, Fantino, provincia Sanchez Ramírez", "keywords": ["fantino", "jaime vargas", "sanchez ramirez", "sánchez ramírez", "centro fantino", "foxpack", "fox pack", "fox"], "order_index": 18, "delivery_only": false, "phone": "809-681-6002 Ext: 460 / WhatsApp: 829-359-7824", "city": "Fantino", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 460 / WhatsApp: 829-359-7824", "city": "Fantino", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "COTUI / LA MATA", "code": "cotui-la-mata", "location_text": "Calle Parque Central #10, Villa La Mata, Sánchez Ramírez. (Frente al Parque del pueblo)", "keywords": ["cotui", "mata", "cotuí", "la mata", "villa la mata", "parque central cotui", "foxpack", "fox pack", "fox"], "order_index": 19, "delivery_only": false, "phone": "809-681-6002 Ext: 461", "city": "Cotuí", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 461", "city": "Cotuí", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "MONTE PLATA", "code": "monte-plata", "location_text": "Calle Julio Abreu Cuello esquina Luis Arturo Rojas, Monte Plata", "keywords": ["monte", "plata", "monte plata", "julio abreu", "luis arturo rojas", "monteplata", "foxpack", "fox pack", "fox"], "order_index": 20, "delivery_only": false, "phone": "809-681-6002 Ext: 330 / WhatsApp: 849-882-1463", "city": "Monte Plata", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 330 / WhatsApp: 849-882-1463", "city": "Monte Plata", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "YAMASA", "code": "yamasa", "location_text": "Calle Ramón Matias Mella No. 4-B (al lado del Centro Médico Concepcion & Diaz) antigua Agua Lake", "keywords": ["yamasa", "yamasá", "matias mella", "concepcion diaz", "agua lake", "foxpack", "fox pack", "fox"], "order_index": 21, "delivery_only": false, "phone": "809-681-6002 Ext: 328 / WhatsApp: 829-889-5466", "city": "Yamasá", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 328 / WhatsApp: 829-889-5466", "city": "Yamasá", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "LOS GIRASOLES", "code": "los-girasoles", "location_text": "Calle Emma Balaguer No. 20, Los Girasoles", "keywords": ["girasoles", "santo domingo norte", "los girasoles", "emma balaguer", "foxpack", "fox pack", "fox"], "order_index": 22, "delivery_only": false, "phone": "809-681-6002 Ext: 315 / Whatsapp: 829-916-0998", "city": "Santo Domingo Norte", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 315 / Whatsapp: 829-916-0998", "city": "Santo Domingo Norte", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "BAVARO EL EJECUTIVO", "code": "bavaro-el-ejecutivo", "location_text": "C/ Ramon Rodríguez s/n sector El Ejecutivo Bávaro, Distrito Municipal Verón, Higuey, La Altagracia", "keywords": ["bavaro", "ejecutivo", "bávaro", "el ejecutivo", "veron bavaro", "ejecutivo bavaro", "punta cana bavaro", "foxpack", "fox pack", "fox"], "order_index": 23, "delivery_only": false, "phone": "809-681-6002", "city": "Bávaro", "notes": "", "metadata": {"phone": "809-681-6002", "city": "Bávaro", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "SAN PEDRO", "code": "san-pedro", "location_text": "Calle José Hazim Frente a Jumbo, San Pedro de Macoris.", "keywords": ["san", "pedro", "san pedro de macorís", "san pedro", "san pedro de macoris", "jose hazim", "jumbo san pedro", "spm", "foxpack", "fox pack", "fox"], "order_index": 24, "delivery_only": false, "phone": "809-681-6002 Ext: 321 / WhatsApp: 809-914-3204", "city": "San Pedro de Macorís", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 321 / WhatsApp: 809-914-3204", "city": "San Pedro de Macorís", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "HIGÜEY", "code": "higuey", "location_text": "Calle Juan XXIII, Sector el Naranjo, Frente a Mama Juana", "keywords": ["higüey", "higuey", "juan xxiii", "el naranjo", "mama juana", "foxpack", "fox pack", "fox"], "order_index": 25, "delivery_only": false, "phone": "809-681-6002 Ext: 324 WhatsApp: 809-554-0109", "city": "Higüey", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 324 WhatsApp: 809-554-0109", "city": "Higüey", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "LA ROMANA", "code": "la-romana", "location_text": "AVENIDA LIBERTAD #3 A LOCAL 1B FRENTE A JUMBO", "keywords": ["romana", "la romana", "avenida libertad", "jumbo la romana", "foxpack", "fox pack", "fox"], "order_index": 26, "delivery_only": false, "phone": "809-681-6002 Ext: 307 / Dir: 809-883-7204", "city": "La Romana", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 307 / Dir: 809-883-7204", "city": "La Romana", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "VERON BÁVARO", "code": "veron-bavaro", "location_text": "CALLE 1ra No. 6 Local No. 3 SECTOR VILLA PROGRESO, Distrito municipal Verón, Bávaro, Punta Cana", "keywords": ["veron", "bávaro", "verón", "villa progreso", "veron bavaro", "punta cana veron", "foxpack", "fox pack", "fox"], "order_index": 27, "delivery_only": false, "phone": "809-681-6002 Ext: 337 / Dir: 829-423-7126 / WhatsApp: 809-714-6088", "city": "Verón", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 337 / Dir: 829-423-7126 / WhatsApp: 809-714-6088", "city": "Verón", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "LAS TERRENAS", "code": "las-terrenas", "location_text": "Las Terrenas, Calle Duarte, Frente al Banco Popular", "keywords": ["terrenas", "las terrenas", "duarte terrenas", "banco popular terrenas", "samana", "foxpack", "fox pack", "fox"], "order_index": 28, "delivery_only": false, "phone": "809-681-6002 Ext: 334 / WhatsApp: 809-714-8865", "city": "Las Terrenas", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 334 / WhatsApp: 809-714-8865", "city": "Las Terrenas", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "JIMA ABAJO", "code": "jima-abajo", "location_text": "Jima Abajo, Calle Enrriquillo #3, La Vega", "keywords": ["jima", "abajo", "jima abajo", "enriquillo jima", "la vega jima", "foxpack", "fox pack", "fox"], "order_index": 29, "delivery_only": false, "phone": "809-681-6002 Ext.", "city": "Jima Abajo", "notes": "", "metadata": {"phone": "809-681-6002 Ext.", "city": "Jima Abajo", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "BANI", "code": "bani", "location_text": "Calle 27 de febrero, esquina padre billini local 1-A, Bani", "keywords": ["bani", "baní", "padre billini", "27 febrero bani", "peravia", "foxpack", "fox pack", "fox"], "order_index": 30, "delivery_only": false, "phone": "809-681-6002 Ext: 341 / WhatsApp: 829-624-1145", "city": "Baní", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 341 / WhatsApp: 829-624-1145", "city": "Baní", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "VILLA ALTAGRACIA (SOLO DELIVERY)", "code": "villa-altagracia-solo-delivery", "location_text": "Plaza Sofia, Local # 105, Frente al Antiguo Hotel Villa Verde, Villa Altagracia", "keywords": ["villa", "altagracia", "delivery", "villa altagracia", "plaza sofia", "hotel villa verde", "solo delivery villa altagracia", "solo delivery", "domicilio", "foxpack", "fox pack", "fox"], "order_index": 31, "delivery_only": true, "phone": "809-681-6002 Ext: 320 / WhatsApp: 809-418-7263", "city": "Villa Altagracia", "notes": "Solo Delivery", "metadata": {"phone": "809-681-6002 Ext: 320 / WhatsApp: 809-418-7263", "city": "Villa Altagracia", "delivery_only": true, "notes": "Solo Delivery", "source": "bulk_import_foxpack"}}, {"name": "LOS ALCARRIZOS / JUANA SALTITOPA", "code": "los-alcarrizos-juana-saltitopa", "location_text": "Calle Proyecto #18 Juana Saltitopa, Los Alcarrizos Santo Domingo Oeste", "keywords": ["alcarrizos", "juana", "saltitopa", "los alcarrizos", "juana saltitopa", "proyecto 18", "foxpack", "fox pack", "fox"], "order_index": 32, "delivery_only": false, "phone": "809-681-6002 Ext: 314", "city": "Los Alcarrizos", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 314", "city": "Los Alcarrizos", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "SAN CRISTOBAL", "code": "san-cristobal", "location_text": "Francisco Jacinto Peinado #17 San Cristobal", "keywords": ["san", "cristobal", "san cristóbal", "san cristobal", "jacinto peinado", "sc", "peinado", "foxpack", "fox pack", "fox"], "order_index": 33, "delivery_only": false, "phone": "809-681-6002 Ext: 343", "city": "San Cristóbal", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 343", "city": "San Cristóbal", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "V CENTENARIO", "code": "v-centenario", "location_text": "Calle seibo #9 Villa Consuelo. DN, Frente a Plaza San Martín, V centenario.", "keywords": ["centenario", "distrito nacional", "v centenario", "villa consuelo", "seibo", "plaza san martin", "foxpack", "fox pack", "fox"], "order_index": 34, "delivery_only": false, "phone": "809-681-6002 Ext: 306", "city": "Distrito Nacional", "notes": "", "metadata": {"phone": "809-681-6002 Ext: 306", "city": "Distrito Nacional", "delivery_only": false, "notes": "", "source": "bulk_import_foxpack"}}, {"name": "TENARES / SOLO DELIVERY", "code": "tenares-solo-delivery", "location_text": "Solo Delivery, Tenares, Hnas Mirabal, Salcedo", "keywords": ["tenares", "delivery", "salcedo", "hermanas mirabal tenares", "solo delivery tenares", "hnas mirabal", "solo delivery", "domicilio", "foxpack", "fox pack", "fox"], "order_index": 35, "delivery_only": true, "phone": "809-681-6002 Ext: 432 / Tel: 829-729-0006", "city": "Tenares", "notes": "Solo Delivery", "metadata": {"phone": "809-681-6002 Ext: 432 / Tel: 829-729-0006", "city": "Tenares", "delivery_only": true, "notes": "Solo Delivery", "source": "bulk_import_foxpack"}}];
const EMAIL = "info@foxpack.us";

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of fs.readFileSync(f, 'utf8').split(/\n/)) {
      const m = line.match(/^(POSTGRES_URL|DATABASE_URL)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

(async () => {
  const p = new Pool({ connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL });
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // resolve team from email
    const userRes = await client.query(
      `SELECT u.id as user_id, u.email, tm.team_id, t.name as team_name
       FROM users u
       JOIN team_members tm ON tm.user_id = u.id
       JOIN teams t ON t.id = tm.team_id
       WHERE lower(u.email) = lower($1)
       ORDER BY tm.role = 'owner' DESC NULLS LAST, tm.id ASC
       LIMIT 5`,
      [EMAIL]
    );
    if (!userRes.rows.length) throw new Error('User/team not found for ' + EMAIL);
    console.log('USER ROWS', JSON.stringify(userRes.rows, null, 2));
    const teamId = Number(userRes.rows[0].team_id);
    const ownerUserId = Number(userRes.rows[0].user_id);
    console.log('TEAM', teamId, userRes.rows[0].team_name);

    // all team members
    const members = await client.query(
      `SELECT user_id, role FROM team_members WHERE team_id = $1 ORDER BY id ASC`,
      [teamId]
    );
    console.log('MEMBERS', members.rows.length, JSON.stringify(members.rows));
    const userIds = members.rows.map(r => Number(r.user_id)).filter(Boolean);
    if (!userIds.length) userIds.push(ownerUserId);

    // ensure branch settings
    await client.query(
      `INSERT INTO branch_settings (team_id, is_active, company_name, company_timezone, created_at, updated_at)
       VALUES ($1, true, $2, 'America/Santo_Domingo', NOW(), NOW())
       ON CONFLICT (team_id) DO UPDATE SET is_active = true, updated_at = NOW()`,
      [teamId, 'FoxPack']
    ).catch(async (e) => {
      // maybe no unique on team_id
      const exists = await client.query(`SELECT id FROM branch_settings WHERE team_id=$1 LIMIT 1`, [teamId]);
      if (!exists.rows.length) {
        await client.query(
          `INSERT INTO branch_settings (team_id, is_active, company_name, company_timezone, created_at, updated_at)
           VALUES ($1, true, $2, 'America/Santo_Domingo', NOW(), NOW())`,
          [teamId, 'FoxPack']
        );
      } else {
        await client.query(`UPDATE branch_settings SET is_active=true, updated_at=NOW() WHERE team_id=$1`, [teamId]);
      }
    });

    // Soft-delete previous bulk foxpack imports? Keep existing non-matching. Upsert by code.
    let created = 0, updated = 0, membersLinked = 0;
    const branchIds = [];

    for (const b of branches) {
      const meta = { ...b.metadata };
      const welcome = b.delivery_only
        ? `Perfecto. Te conectamos con {sucursal} (delivery). Un agente te atenderá en breve.`
        : `Perfecto. Te conectamos con {sucursal}. Un miembro del equipo continuará contigo.`;

      const existing = await client.query(
        `SELECT id FROM branches WHERE team_id=$1 AND code=$2 AND deleted_at IS NULL LIMIT 1`,
        [teamId, b.code]
      );

      let branchId;
      if (existing.rows.length) {
        const r = await client.query(
          `UPDATE branches SET
              name=$3,
              location_text=$4,
              keywords=$5::jsonb,
              order_index=$6,
              is_active=true,
              welcome_message=$7,
              metadata=$8::jsonb,
              updated_at=NOW(),
              deleted_at=NULL
           WHERE id=$1 AND team_id=$2
           RETURNING id`,
          [existing.rows[0].id, teamId, b.name, b.location_text, JSON.stringify(b.keywords), b.order_index, welcome, JSON.stringify(meta)]
        );
        branchId = r.rows[0].id;
        updated += 1;
      } else {
        // if code conflict with deleted, revive
        const deleted = await client.query(
          `SELECT id FROM branches WHERE team_id=$1 AND code=$2 LIMIT 1`,
          [teamId, b.code]
        );
        if (deleted.rows.length) {
          const r = await client.query(
            `UPDATE branches SET
                name=$3, location_text=$4, keywords=$5::jsonb, order_index=$6, is_active=true,
                welcome_message=$7, metadata=$8::jsonb, updated_at=NOW(), deleted_at=NULL
             WHERE id=$1 AND team_id=$2 RETURNING id`,
            [deleted.rows[0].id, teamId, b.name, b.location_text, JSON.stringify(b.keywords), b.order_index, welcome, JSON.stringify(meta)]
          );
          branchId = r.rows[0].id;
          updated += 1;
        } else {
          const r = await client.query(
            `INSERT INTO branches (
               team_id, name, code, location_text, keywords, order_index, is_active,
               welcome_message, out_of_hours_message, timezone, office_hours_enabled,
               office_days, start_time, end_time, metadata, created_at, updated_at
             ) VALUES (
               $1,$2,$3,$4,$5::jsonb,$6,true,
               $7,
               'Gracias por escribirnos. En este momento {sucursal} esta fuera de horario. Nuestro horario es {horario}. Dejanos tu mensaje y te responderemos tan pronto estemos disponibles.',
               'America/Santo_Domingo', false,
               '[1,2,3,4,5,6]'::jsonb, '08:00', '20:00', $8::jsonb, NOW(), NOW()
             ) RETURNING id`,
            [teamId, b.name, b.code, b.location_text, JSON.stringify(b.keywords), b.order_index, welcome, JSON.stringify(meta)]
          );
          branchId = r.rows[0].id;
          created += 1;
        }
      }
      branchIds.push(branchId);

      // assign ALL team members to this branch
      for (let i = 0; i < userIds.length; i++) {
        const uid = userIds[i];
        const priority = i + 1;
        const up = await client.query(
          `INSERT INTO branch_members (team_id, branch_id, user_id, priority, is_active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,true,NOW(),NOW())
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [teamId, branchId, uid, priority]
        ).catch(async (err) => {
          // no unique constraint maybe - manual upsert
          const ex = await client.query(
            `SELECT id FROM branch_members WHERE team_id=$1 AND branch_id=$2 AND user_id=$3 LIMIT 1`,
            [teamId, branchId, uid]
          );
          if (ex.rows.length) {
            await client.query(
              `UPDATE branch_members SET is_active=true, priority=$4, updated_at=NOW(), deleted_at=NULL
               WHERE id=$1`,
              [ex.rows[0].id, teamId, branchId, priority]
            );
            return { rows: [{ id: ex.rows[0].id }] };
          }
          const ins = await client.query(
            `INSERT INTO branch_members (team_id, branch_id, user_id, priority, is_active, created_at, updated_at)
             VALUES ($1,$2,$3,$4,true,NOW(),NOW()) RETURNING id`,
            [teamId, branchId, uid, priority]
          );
          return ins;
        });
        if (up && up.rows && up.rows.length) membersLinked += 1;
        else {
          // ensure active
          await client.query(
            `UPDATE branch_members SET is_active=true, deleted_at=NULL, priority=$4, updated_at=NOW()
             WHERE team_id=$1 AND branch_id=$2 AND user_id=$3`,
            [teamId, branchId, uid, priority]
          );
          membersLinked += 1;
        }
      }
    }

    // keep/create global fallback if none
    const global = await client.query(
      `SELECT id FROM branches WHERE team_id=$1 AND code='global' AND deleted_at IS NULL LIMIT 1`,
      [teamId]
    );
    if (!global.rows.length) {
      const g = await client.query(
        `INSERT INTO branches (team_id, name, code, location_text, keywords, order_index, is_active, welcome_message, timezone, office_days, start_time, end_time, metadata, created_at, updated_at)
         VALUES ($1,'Área global','global','global, general, toda la ciudad','["global","general","no se","toda la ciudad","foxpack"]'::jsonb, 999, true,
           'Te conectamos con nuestro equipo central. Un agente te atenderá en breve.',
           'America/Santo_Domingo','[1,2,3,4,5,6]'::jsonb,'08:00','20:00','{}'::jsonb,NOW(),NOW())
         RETURNING id`,
        [teamId]
      );
      const gid = g.rows[0].id;
      for (let i = 0; i < userIds.length; i++) {
        await client.query(
          `INSERT INTO branch_members (team_id, branch_id, user_id, priority, is_active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,true,NOW(),NOW())
           ON CONFLICT DO NOTHING`,
          [teamId, gid, userIds[i], i+1]
        ).catch(async () => {
          const ex = await client.query(`SELECT id FROM branch_members WHERE team_id=$1 AND branch_id=$2 AND user_id=$3`, [teamId, gid, userIds[i]]);
          if (!ex.rows.length) {
            await client.query(
              `INSERT INTO branch_members (team_id, branch_id, user_id, priority, is_active, created_at, updated_at)
               VALUES ($1,$2,$3,$4,true,NOW(),NOW())`,
              [teamId, gid, userIds[i], i+1]
            );
          } else {
            await client.query(`UPDATE branch_members SET is_active=true, deleted_at=NULL WHERE id=$1`, [ex.rows[0].id]);
          }
        });
      }
      console.log('global branch ensured', gid);
    }

    await client.query('COMMIT');

    const countB = await client.query(
      `SELECT count(*)::int AS n FROM branches WHERE team_id=$1 AND deleted_at IS NULL AND is_active=true`,
      [teamId]
    );
    const countM = await client.query(
      `SELECT count(*)::int AS n FROM branch_members WHERE team_id=$1 AND is_active=true AND deleted_at IS NULL`,
      [teamId]
    );
    const list = await client.query(
      `SELECT id, name, code, jsonb_array_length(keywords) AS kw, order_index
       FROM branches WHERE team_id=$1 AND deleted_at IS NULL
       ORDER BY order_index ASC`,
      [teamId]
    );
    console.log(JSON.stringify({
      ok: true,
      teamId,
      created,
      updated,
      membersLinkedApprox: membersLinked,
      teamMembers: userIds.length,
      activeBranches: countB.rows[0].n,
      activeMemberships: countM.rows[0].n,
      branches: list.rows,
    }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('FAILED', e);
    process.exit(1);
  } finally {
    client.release();
    await p.end();
  }
})();
