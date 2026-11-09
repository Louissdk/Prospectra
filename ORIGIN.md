# Origem e escopo desta versão

O pacote de origem recebido foi o projeto MazyOS Scraper, uma aplicação Go com automação Playwright e interface web local/SaaS.

O Prospectra é uma implementação separada para Chrome Manifest V3. O backend Go, Playwright, infraestrutura SaaS e os binários do projeto anterior não são executados nem incorporados nesta extensão. O código da extensão foi escrito para usar as APIs do Chrome e o DOM do Google Maps, mantendo o objetivo funcional de organizar empresas e enriquecer dados públicos de contato.

Como o Google Maps altera o HTML e a experiência do usuário com frequência, os seletores da extensão podem precisar de manutenção. A coleta de resultados deve ser validada no navegador real do usuário antes de qualquer uso operacional em larga escala.
