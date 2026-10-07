# Kamba Market 4.0 — Plataforma comercial

Kamba Market é uma base de produção para marketplace angolano de produtos, serviços e afiliados.

## Incluído
- Marketplace + serviços + PWA
- Registo/login com scrypt e sessões expiráveis
- Pesquisa, favoritos, anúncios e moderação
- Encomendas, pagamentos por adaptadores e webhooks preparados
- Afiliados com links, conversões, carteira e levantamentos
- Mensagens e notificações
- Upload de imagens com validação de assinatura do ficheiro
- Endpoints `/api/health` e `/api/ready`
- Dashboard administrativo com métricas comerciais
- PostgreSQL 16 + MinIO/S3 + Caddy/HTTPS via Docker Compose
- Backups PostgreSQL
- Scripts de preflight/deploy
- Documentação de segurança, monetização e produção

## Modo local
```bash
npm install
npm start
```
Abra `http://localhost:3000`.

## Produção
1. Copie `.env.production.example` para `.env` e preencha segredos reais.
2. Execute `infra/ops/preflight.sh`.
3. Use `infra/docker-compose.production.yml`.
4. Aponte o DNS do domínio para o VPS e deixe Caddy emitir o certificado.
5. Configure um provedor real de pagamentos; `mock` é apenas para testes.

## Monetização
Consultar `docs/MONETIZACAO_4_0.md`.

## Segurança
Consultar `docs/PRODUCAO_4_0.md`.
