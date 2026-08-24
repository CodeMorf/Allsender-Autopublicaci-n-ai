# AllSender Campaigns Cron

Campa?as programadas se procesan por API interna:

```bash
curl -fsS "https://auth.allsender.tech/api/campaigns/process?secret=CAMPAIGN_CRON_SECRET" >> /www/wwwroot/auth.allsender.tech/storage/logs/cron-campaigns.log 2>&1
```

Frecuencia recomendada en aaPanel: cada 1 minuto.

Variables:
- `CAMPAIGN_CRON_SECRET`: secreto del cron. Si no existe, el sistema usa temporalmente `20262090`.
- `ZERNIO_API_KEY`: requerida para campa?as WhatsApp Oficial via Zernio Broadcast.

Flujo operativo:
1. Crear campa?a en `/es/campaigns/new`.
2. Elegir cuenta WhatsApp conectada.
3. Cargar audiencia desde contactos recientes o CSV/XLS/XLSX.
4. Seleccionar plantilla aprobada.
5. Guardar borrador, enviar ahora o programar.

## Marketing IA y Autopublicación

El script `scripts/marketing-cron.sh` lee el secreto del entorno sin imprimirlo
y lo envía en la cabecera `Authorization: Bearer`. No se deben volver a añadir
tokens en la URL del cron.

Ejemplos para aaPanel (ajustar frecuencia según la configuración de cada
equipo; Autopublicación respeta `frequencyHours` y no genera duplicados):

```cron
* * * * * cd /www/wwwroot/auth.allsender.tech && bash scripts/marketing-cron.sh comentarios-ia/hydrate 80 >> storage/logs/cron-comentarios-ia-hydrate.log 2>&1
* * * * * cd /www/wwwroot/auth.allsender.tech && bash scripts/marketing-cron.sh comentarios-ia/respond 80 >> storage/logs/cron-comentarios-ia-respond.log 2>&1
*/5 * * * * cd /www/wwwroot/auth.allsender.tech && bash scripts/marketing-cron.sh autopublicar/generate 10 >> storage/logs/cron-autopublicar-generate.log 2>&1
* * * * * cd /www/wwwroot/auth.allsender.tech && bash scripts/marketing-cron.sh autopublicar/publish 20 >> storage/logs/cron-autopublicar-publish.log 2>&1
*/10 * * * * cd /www/wwwroot/auth.allsender.tech && bash scripts/marketing-cron.sh autopublicar/retry 20 >> storage/logs/cron-autopublicar-retry.log 2>&1
15 3 * * * cd /www/wwwroot/auth.allsender.tech && bash scripts/marketing-cron.sh autopublicar/cleanup 50 >> storage/logs/cron-autopublicar-cleanup.log 2>&1
```

Comentarios IA y Autopublicación usan únicamente el runtime CodeMorf. Si
CodeMorf no responde, Comentarios IA conserva una respuesta determinista
segura y Autopublicación deja un borrador; nunca se envía contenido generado
por OpenAI, Gemini u OpenRouter como fallback silencioso.
