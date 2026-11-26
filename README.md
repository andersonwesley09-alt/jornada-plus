# Jornada+ V5.2 — Conta por usuário

Projeto web responsivo para marcações de ponto, fotos opcionais, jornadas personalizadas, banco de horas, calendário, histórico e relatórios. **Sem vínculo com empresas e sem exigir e-mail de quem cria a conta.**

## Conteúdo

- `index.html`, `app.js`, `styles.css`: aplicativo original com atualização do login.
- `config.js`: somente URL e chave **pública/anon** do Supabase.
- `setup.sql`: tabelas, RLS, fotos privadas e armazenamento de códigos de recuperação (hash).
- `supabase/functions/jornada-contas/index.ts`: serviço de cadastro, recuperação e renovação dos códigos.
- `supabase/config.toml`: função com verificação JWT de gateway desabilitada; a função valida a sessão na renovação.
- `ABRIR_DEMONSTRACAO.html`: demonstração independente do servidor online.

**O que é preciso para contas reais:** implantar a função `jornada-contas`, executar `setup.sql` e preencher `config.js`. O GitHub Pages hospeda só a interface, não os dados.

Leia `LEIA_PRIMEIRO.txt` antes de publicar. Não envie `SERVICE_ROLE_KEY`, `JORNADA_RECOVERY_PEPPER` nem credenciais reais ao GitHub.

O login por username é implementado sobre Supabase Auth usando um identificador técnico interno reservado. Nenhum endereço de e-mail é pedido ao usuário. O código de recuperação de 80 bits só aparece no cadastro e após sua rotação, sendo guardado no banco com HMAC SHA-256, não em texto puro.

### Publicação

Arquivos públicos do site na raiz do repositório `jornada-plus`: `index.html`, `app.js`, `styles.css`, `sw.js`, `config.js`, `manifest.webmanifest`, `icon.png`, `icon-192.png`.

O código da função deve ser implantado no painel **Supabase Edge Functions** ou pelo Supabase CLI; subir o `.ts` ao GitHub não o executa. Configure `JORNADA_ALLOWED_ORIGINS` com a origem exata do seu GitHub Pages.

**Status:** fluxo de telas testado com respostas simuladas; não foi validado com Supabase em produção.
