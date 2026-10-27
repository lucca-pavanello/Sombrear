"""O que o ouvido (STT) precisa saber da loja.

Palavras que o cliente fala e que o ouvido erra sem dica: na ligação de teste de 21/10 "pra sala"
virou "Começá-lo", "Priscila" e "Perciana Brassala". Vão como keyterm para o Deepgram.
"""

PALAVRAS_DA_LOJA = [
    "Sombrear", "persiana", "persianas", "cortina", "cortinas", "rolô", "blackout", "tela solar",
    "double vision", "romana", "vertical", "horizontal", "bandô", "motorizada", "voil", "linho", "wave",
    "sala", "quarto", "cozinha", "escritório", "varanda", "sacada", "janela", "vão",
    "Rio Preto", "Mirassol", "WhatsApp",
]
