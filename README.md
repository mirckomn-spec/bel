# Hots - area privada de comprovantes

Site em Next.js com login privado para equipe selecionada, upload de prints/gravacoes e visualizacao dos comprovantes em um painel interno.

## Rodar localmente

1. Instale as dependencias:
   ```bash
   npm install
   ```
2. Ajuste as variaveis no arquivo `.env.local` (principalmente `JWT_SECRET` e usuario/senha inicial).
3. Inicie:
   ```bash
   npm run dev
   ```
4. Abra [http://localhost:3000](http://localhost:3000).

## Como funciona o login

- Nao existe cadastro publico.
- Login fixo e unico:
  - Usuario: `bel`
  - Senha: `bel94838`

## Comprovantes

- Upload de `image/*` e `video/*` no dashboard.
- Metadados ficam na collection `proofs`.
- Arquivos novos sao enviados para um canal do Discord e o sistema salva a URL.

## Variaveis de ambiente (Discord)

- `DISCORD_BOT_TOKEN`: token do bot com permissao de enviar mensagens/anexos.
- `DISCORD_UPLOADS_CHANNEL_ID`: ID do canal que recebe comprovantes e avatares.
