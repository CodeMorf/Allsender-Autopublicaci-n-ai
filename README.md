# AllSender Autopublicación IA

Espejo mantenible del módulo integrado en AllSender Auth. No es una aplicación independiente: comparte autenticación multi-tenant, PostgreSQL/Drizzle, Zernio y el runtime CodeMorf.

## Fuente de producción

- Monorepo: `CodeMorf/omnichannel-`
- Checkout fuente: `campaigns3-work`
- Las variables, tokens y claves se configuran únicamente en el entorno de Auth; nunca se guardan aquí.

## Verificación

Sincronizar estos archivos dentro de Auth antes de ejecutar build y pruebas:

```powershell
pnpm exec tsc --noEmit --pretty false
pnpm build
```

La publicación de este espejo no sustituye el despliegue del monorepo ni la verificación E2E con una cuenta Zernio conectada.
