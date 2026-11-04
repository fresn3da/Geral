# Kettlebellpedia

Enciclopédia de treinos de kettlebell para catalogar treinos encontrados na internet (com a fonte de cada um) e acompanhar a evolução. Começou com o **November Shred Challenge** (@trainwithpb_), que continua como a primeira sequência cadastrada.

- **Enciclopédia:** sequências, treinos e exercícios com busca, página própria e fonte (nome + link).
- **Sequências:** dias numerados ou dias da semana repetidos por N semanas, com data de início; também treinos avulsos.
- **Adm (Gerenciar):** quem edita o app cadastra exercícios (passo a passo, YouTube, vídeo Demo), treinos, sequências e o aquecimento. Todos leem; só editores alteram.
- **Treino:** modo foco, timers com alarme, diário de bordo com horários e evolução. O progresso de cada pessoa é privado.

---

## Detalhes da versão inicial (November Shred)

### Funcionalidades
- **Hoje**: treino do dia (Dia 1 = 01/11, ajustável), progresso, sequência e minutos.
- **Calendário** dos 30 dias com as cores das categorias e marcação dos concluídos.
- **Treino do dia**: exercícios com vídeos (YouTube EN/PT), metas ajustadas por nível (iniciante / intermediário / avançado), aquecimento.
- **Timers** com bipes, vibração e tela sempre ligada:
  - Séries × reps: marque cada série e o descanso começa sozinho.
  - AMRAP: contagem regressiva + botão "+1 Round".
  - 30s cada: timer intervalado que mostra o exercício atual, o próximo e o descanso.
- **Registro**: peso do kettlebell, duração, rounds do AMRAP, reps por exercício, RPE e notas.
- **Evolução**: gráficos de rounds dos AMRAPs, peso do kettlebell, RPE, peso corporal/cintura, progresso por categoria e recordes por exercício.
- **Exercícios**: biblioteca com busca, vídeos e histórico de cada movimento. Dá para **fixar seu vídeo favorito** (★) em cada exercício.
- Funciona **offline** e pode ser instalado na tela inicial. Backup em JSON (exportar/importar).

## Como usar
Os dados ficam salvos no navegador do aparelho (localStorage).

**Rodar localmente**
```bash
cd november-shred
python3 -m http.server 8000
# abra http://localhost:8000
```

**No celular**: publique a pasta no GitHub Pages (Settings → Pages → branch + pasta `/november-shred`… ou mova os arquivos para a raiz/`docs`), abra o link e use "Adicionar à tela inicial".

## Vídeos
Os links abrem uma busca no YouTube com o nome técnico do exercício (em inglês e em português), para você escolher um vídeo de boa qualidade. Encontrou um bom? Abra o exercício e cole o link em "★ Fixar meu vídeo favorito".

> Aqueça antes, hidrate-se e pare se algo parecer errado. Em caso de problemas de saúde, consulte um médico.
