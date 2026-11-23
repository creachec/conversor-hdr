# Conversor HDR

Interface local para converter capturas JPEG XR (`.jxr`) em AVIF HDR no Windows. Aceita conversão em lote e reúne os arquivos prontos em um ZIP.

## Como rodar

1. Instale o Node.js 22.12 ou superior.
2. Baixe o [jxr_to_avif](https://github.com/ledoge/jxr_to_avif/releases). Coloque `jxr_to_avif.exe` em `bin/` ou aponte a variável `JXR_TO_AVIF` para o executável.
3. Rode `npm ci` e `npm start`.
4. Abra [http://127.0.0.1:3000](http://127.0.0.1:3000).

O conversor nativo é um projeto separado mantido por [ledoge](https://github.com/ledoge/jxr_to_avif). Os resultados ficam na pasta local `converted/`.
