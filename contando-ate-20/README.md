# Vamos Contar! 🔢

App para crianças aprenderem a contar de 1 a 20 tocando em emojis.

## Como funciona
1. Toque em **▶ Começar** (necessário para liberar o som no celular).
2. Aparecem **10 figuras**. A cada toque, a figura recebe o número e a voz fala: "um", "dois", "três"…
3. Ao chegar em **10**: festa 🎉 e aparecem mais 10 figuras — agora até **20**.
4. Ao chegar em **20**: o app faz a **contagem completa de 1 a 20**, destacando cada figura enquanto fala o número, para ela acompanhar.
5. Depois **começa de novo** com outro tema (frutas, bichinhos, carrinhos, natureza, animais, brinquedos).

### Repetir junto (🎤)
Na contagem completa, o app fala o número e **espera ela repetir** antes de ir para o próximo.
- Com microfone, o app reconhece o número falado (aceita "quatorze"/"catorze", "duas", etc.).
- Se ela tentar 3 vezes e o app não entender, ele segue em frente para não frustrar.
- Se ninguém falar por 7 segundos, o app repete o número ("Fala comigo: cinco!").
- O botão **👄 Falei!** avança na hora, para aparelhos sem microfone ou se o reconhecimento falhar.
- O botão 🎤 no topo liga/desliga esse modo (desligado, a contagem é automática como antes).

O microfone funciona no Chrome/Edge (computador e Android) e no Safari. No app do Claude para celular o microfone não é liberado; lá use o botão "Falei!".

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
