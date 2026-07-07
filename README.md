# Reader Analytics

Reader Analytics é um projeto pessoal criado para acompanhar e incentivar o hábito de leitura dos meus irmãos.

A ideia surgiu após perceber que apenas definir uma meta diária de leitura não era suficiente para manter a constância. Além disso, acompanhar manualmente o progresso (tempo, páginas lidas e evolução) acabava sendo trabalhoso. O objetivo deste projeto é automatizar esse processo e transformar a leitura em uma atividade acompanhável por meio de dados e estatísticas.

## Objetivos

* Incentivar o hábito de leitura.
* Medir o tempo real de leitura.
* Acompanhar a evolução da fluência ao longo do tempo.
* Registrar estatísticas de cada sessão de leitura.
* Identificar palavras que geram maior dificuldade.
* Disponibilizar um painel com gráficos e indicadores de progresso.

## Como funciona

O aplicativo abre livros no formato EPUB e os divide em blocos de aproximadamente 300 palavras, chamados de "páginas virtuais".

Durante a leitura, o texto só permanece visível enquanto o leitor mantém pressionado um botão específico da interface. Dessa forma, o tempo registrado corresponde apenas ao período em que a leitura está realmente acontecendo.

Ao finalizar cada página, o sistema registra automaticamente informações como:

* livro;
* página;
* quantidade de palavras;
* quantidade de caracteres;
* tempo efetivo de leitura;
* data e horário;
* destaques realizados pelo leitor.

Nenhuma ação manual é necessária para registrar esses dados.

## Dashboard

O projeto possui um painel de estatísticas com informações como:

* tempo de leitura por dia;
* páginas lidas por dia;
* palavras lidas;
* velocidade média de leitura;
* evolução ao longo das semanas;
* sequência de dias lendo;
* progresso de cada livro;
* palavras destacadas durante a leitura.

## Motivação

Este projeto não pretende ser apenas mais um leitor de EPUB.

O foco é utilizar tecnologia para incentivar a leitura e permitir acompanhar a evolução do leitor de forma objetiva, mostrando métricas que normalmente não estão disponíveis em aplicativos tradicionais.

Além de servir como ferramenta para meus irmãos, o projeto também funciona como um estudo sobre experiência do usuário, análise de leitura, processamento de texto e visualização de dados.

## Tecnologias

* React
* TypeScript
* Vite
* React Router
* epub.js
* Recharts
* LocalStorage

## Status

🚧 Em desenvolvimento.
