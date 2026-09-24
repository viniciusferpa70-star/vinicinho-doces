# Vinicinho Doces

Sistema web para controle de vendas, produtos, produção, estoque, clientes, fornecedores, despesas, caixa e relatórios.

Os dados são sincronizados com o Firebase e o acesso usa a conta Google autorizada.

## Músicas

A aba Músicas permite criar playlists, importar arquivos ou pastas, buscar faixas e ouvir músicas com um player fixo durante a navegação. A importação aceita até 25 MiB por arquivo, conforme os formatos reproduzíveis pelo navegador. O player inclui pausa, anterior/próxima, progresso, volume, aleatório e repetição da playlist.

O projeto atual não possui bucket nem faturamento habilitado. Por isso, os áudios são persistidos como campos binários em blocos de 512 KiB na subcoleção `businesses/vinicinho-doces/musicTracks/{sha256}/musicChunks`, separados dos dados operacionais. Os metadados ficam em `musicTracks` e as playlists em `musicPlaylists`. O campo binário não é indexado. A identidade por SHA-256 evita duplicatas. Somente faixas com status `ready` aparecem na biblioteca, após a confirmação de todos os blocos. Uma importação interrompida pode ser retomada importando o mesmo arquivo: os blocos incompletos são sobrescritos.

Os áudios usam a cota de armazenamento, leituras e gravações do Firestore junto com o restante do projeto. Esta solução atende bibliotecas pequenas; para uma biblioteca grande, migrar os binários para Cloud Storage após configurar o armazenamento e seu faturamento. Não há mudança automática de plano. A reprodução carrega a faixa inteira antes de tocar e requer conexão. A reprodução continua entre telas, mas não após fechar ou recarregar a página.

Publicação: `firebase deploy --only firestore,hosting --project vinicinho-doces-vf70`. As regras preservam a restrição à mesma conta autorizada. A exportação de backup dos dados operacionais não inclui os áudios e playlists, que permanecem nas subcoleções da nuvem.
