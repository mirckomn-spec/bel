# Hots - area privada de comprovantes

Site em Next.js hospedado na **Vercel** via **GitHub** (`git push`).

**Producao:** https://bel-gamma.vercel.app

## Deploy (GitHub → Vercel)

1. Faca alteracoes na pasta `rebeca`.
2. Commit e push:
   ```bash
   git add .
   git commit -m "sua mensagem"
   git push
   ```
3. A Vercel faz build e publica automaticamente (nao precisa rodar `npm run dev` nem abrir localhost).

Configuracao na Vercel (projeto conectado ao repo):

- **Framework:** Next.js
- **Root Directory:** `rebeca` (se o repo tiver a pasta `rebeca` na raiz)
- **Build Command:** `npm run build`
- **Output:** padrao Next.js

## Variaveis de ambiente (painel Vercel)

Configure em **Settings → Environment Variables** (Production):

| Variavel | Obrigatoria |
|----------|-------------|
| `MONGODB_URI` | Sim |
| `JWT_SECRET` | Sim |
| `MONGODB_DB_NAME` | Nao (padrao: `hots`) |
| `DISCORD_BOT_TOKEN` | Se usar upload Discord |
| `DISCORD_UPLOADS_CHANNEL_ID` | Se usar upload Discord |

Opcional (dominio proprio):

- `NEXT_PUBLIC_SITE_URL` = `https://seu-dominio.com`

Depois de alterar variaveis: **Redeploy**.

## Erro `bad auth` / `authentication failed`

A URI do MongoDB esta com **usuario ou senha incorretos** (nao e bug do site).

1. No **MongoDB Atlas** → **Database Access** → confira o usuario e a senha.
2. **Connect** → **Drivers** → copie a URI nova.
3. Se a senha tiver caracteres especiais, codifique na URL:
   - `@` → `%40`
   - `#` → `%23`
   - `%` → `%25`
   - `:` → `%3A`
4. Cole em `MONGODB_URI` na Vercel **sem aspas** no inicio/fim.
5. **Redeploy**.

Exemplo de formato:

`mongodb+srv://USUARIO:SENHA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

## Login

- Usuario admin: `bel`
- Senha: definida em `ALLOWED_USERS` no codigo (usuario `bel`)

## Desenvolvimento local (opcional)

So use se quiser testar na sua maquina. **Nao e necessario para publicar o site.**

```bash
npm install
# crie .env.local com as mesmas variaveis da Vercel
npm run dev
```

O site em producao **nao** usa localhost; usa o dominio da Vercel automaticamente.
