# Venta AI 102 + Morf AI Global

Este módulo vive en el checkout de Auth/Omnichannel:

```text
/www/wwwroot/auth.allsender.tech
```

No se instala `VENTA_AI_MORF_101_READY.zip` como overlay y no se usa la ruta de ERP. La entrega válida es la rama de integración que combina:

- `codex/llms-venta-ai-multiprovider` (`4f75712`);
- `agent/morf-ai-global-runtime` (`b604dfb`);
- correcciones de integración y gates de este cambio.

## Preflight de instalación

Desde la rama integrada:

```bash
./scripts/vendor-ai/install.sh /www/wwwroot/auth.allsender.tech
```

El guard exige antes de continuar:

- checkout Git, no overlay ZIP;
- fuentes Sales + Morf presentes;
- exactamente 102 tools únicas;
- `update_order` y `cancel_order` presentes;
- loop activo con `morfGenerate()` y sin credenciales de proveedor físico.

El guard es deliberadamente no mutante. No copia archivos, no cambia branch, no ejecuta migraciones, no construye y no activa tenants.

## Gate obligatorio

```bash
./scripts/vendor-ai/verify.sh /www/wwwroot/auth.allsender.tech
```

`verify.sh` usa `set -euo pipefail`, descubre todas las pruebas `*.test.ts` del checkout y falla ante:

- cualquier prueba omitida o salida `SKIP`;
- cualquier prueba fallida o salida `FAIL`;
- menos de 29 pruebas en el inventario integrado;
- contrato distinto de 102 tools o sin `update_order`/`cancel_order`;
- error de TypeScript;
- error de build;
- whitespace inválido según `git diff --check`.

La suite `docs/vendor-ai/*.test.ts` cubre contrato, canales, aislamiento, idempotencia, rollout, wallet y UI. Las pruebas que requieren PostgreSQL embebido o servicios externos deben ejecutarse en el entorno con sus dependencias disponibles; no se consideran válidas si quedan omitidas.

## Billing y shadow

Ventas IA no cobra directamente. `billing_authority` es `morf_ai` y cada llamada del turno usa un `requestKey` propio para deduplicar uso y débito.

Shadow bloquea la llamada facturable salvo doble aprobación:

1. `VENDOR_AI_ALLOW_BILLED_SHADOW=true`;
2. `morf_ai_team_settings.metadata.vendor_ai_allow_billed_shadow=true` para el tenant aprobado.

## Activación

Este trabajo no activa producción. Después del gate completo, la transición permitida sigue siendo:

```text
off -> shadow -> pilot -> live
```

`pilot` y `live` requieren aprobación explícita por tenant y deben conservar rollback inmediato a `off`.
