# Vamos Contar! 🔢

App para crianças aprenderem a contar de 1 a 20 tocando em emojis.

## Como funciona
1. Toque em **▶ Começar** (necessário para liberar o som no celular).
2. Aparecem **10 figuras**. A cada toque, a figura recebe o número e a voz fala: "um", "dois", "três"…
3. Ao chegar em **10**: festa 🎉 e aparecem mais 10 figuras — agora até **20**.
4. Ao chegar em **20**: o app faz a **contagem completa de 1 a 20**, destacando cada figura enquanto fala o número, para ela acompanhar.
5. Depois **começa de novo** com outro tema (frutas, bichinhos, carrinhos, natureza, animais, brinquedos).

Extras: tocar numa figura já contada repete o número dela; 🔊 liga/desliga o som; 🔄 recomeça.
A trilha de bolinhas embaixo mostra o progresso de 1 a 20.

## Como usar
É um único arquivo (`index.html`), sem dependências e funciona offline.

```bash
cd contando-ate-20
python3 -m http.server 8000
# abra http://localhost:8000
```

No celular, publique no GitHub Pages, abra o link e use "Adicionar à tela inicial".
A voz usa a síntese de fala do aparelho em português (pt-BR).
