# Kamba Market — GitHub + Cloudflare + Render

## Arquitetura simples
- **GitHub Free:** código e histórico.
- **Cloudflare Pages:** frontend HTTPS rápido.
- **Render:** backend Node.js/API para manter compatibilidade com o Kamba Market 4.0.

> Esta edição não migra o backend inteiro para Cloudflare Workers. Isso evita quebrar autenticação, uploads e as rotas existentes.

## Publicação
1. Envie o conteúdo deste diretório para um repositório GitHub.
2. Crie um Web Service no Render a partir desse repositório.
3. Copie a URL do backend, por exemplo `https://kamba-market-api.onrender.com`.
4. No Cloudflare, crie um Pages project chamado `kamba-market`.
5. Adicione estes GitHub Actions secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `KAMBA_API_BASE` = URL pública do backend Render.
6. Faça push para `main`. O workflow publica `public/` no Cloudflare Pages.

## Observações
- O backend atual continua usando `data/db.json` por padrão.
- PostgreSQL, MinIO/S3 e gateways de pagamento continuam preparados como infraestrutura futura, mas não são necessários para o primeiro deploy.
- Para produção real, migre o banco para PostgreSQL e configure armazenamento externo antes de escalar.
