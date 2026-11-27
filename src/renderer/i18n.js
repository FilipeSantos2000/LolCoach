// UI translations. Works as a browser script (window.i18n) and as a Node module (tests).
// Message params: strings, numbers, { num, sign } for formatted numbers, or { key, params } for nested messages.
(function (root) {
  const MESSAGES = {
    en: {
      'app.starting': 'Starting...',
      'app.close': 'Close overlay',
      'app.language': 'Switch language',
      'app.resize': 'Resize (drag or arrow keys)',

      'status.loadingData': 'Loading game data...',
      'status.waiting': 'Waiting for a match...',
      'status.loadingScreen': 'Loading screen...',
      'status.notFound': 'Active player not found (spectating?)',
      'status.notInChampSelect': 'Not in champion select',
      'status.error': 'Error: {message}',

      'meta.off': 'Meta: off (no RIOT_API_KEY)',
      'meta.configError': 'Meta: {message}',
      'meta.starting': 'Meta {patch}: starting...',
      'meta.progress': 'Meta {patch}: {matches}/{target} matches',
      'meta.done': 'Meta {patch}: {matches} matches',
      'meta.badKey': 'Meta: Riot key invalid or expired',
      'meta.error': 'Meta error: {message}',
      'meta.usingOld': '(using {patch})',
      'meta.games': '({games} games for {champion})',

      'game.summary': '{champion} ({archetype}) · {gold}g · Enemy {ad}% AD / {ap}% AP',
      'game.boots': 'Boots',
      'game.nextItems': 'Next items',
      'game.bootsOwned': 'Already owned',

      'flag.healing': 'Healing',
      'flag.burst': 'Burst',
      'flag.cc': 'Heavy CC',
      'flag.crit': 'Crit',
      'flag.highArmor': 'High armor',
      'flag.highMR': 'High MR',
      'flag.heavyAD': 'AD heavy',
      'flag.heavyAP': 'AP heavy',

      'archetype.mage': 'mage',
      'archetype.enchanter': 'enchanter',
      'archetype.marksman': 'marksman',
      'archetype.assassin': 'assassin',
      'archetype.fighter': 'fighter',
      'archetype.tank': 'tank',

      'reason.counter.healing': 'Grievous Wounds vs enemy healing',
      'reason.counter.burst': 'Survive enemy burst',
      'reason.counter.cc': 'Cleanse heavy crowd control',
      'reason.counter.crit': 'Enemy crit stacking',
      'reason.counter.highArmor': 'Armor penetration vs armored enemies',
      'reason.counter.highMR': 'Magic penetration vs magic resist',
      'reason.counter.heavyAD': 'Armor vs AD-heavy team',
      'reason.counter.heavyAP': 'Magic resist vs AP-heavy team',
      'reason.bootsCC': 'Tenacity vs heavy crowd control',
      'reason.bootsDefault': 'Standard boots for your role',
      'reason.meta': 'Meta: {pick}% pick, {wr}% WR',
      'reason.metaPick': 'Meta: {pick}% pick',
      'reason.order': 'Meta: item #{slot} in {pick}% of games',
      'reason.keystone': 'Fits your {rune}',
      'reason.buildsFrom': 'Builds from your {item}',
      'reason.core': 'Core stats for {archetype}',

      'draft.title': 'Suggested picks',
      'draft.allies': 'Allies: {list}',
      'draft.enemies': 'Enemies: {list}',
      'draft.noneYet': 'none yet',
      'draft.empty': 'No suggestions yet',
      'draft.base': '{wr}% WR {role} ({games} games)',
      'draft.vs': '{delta}% vs {name}',
      'draft.with': '{delta}% with {name}',
      'draft.addsAP': 'Adds AP damage',
      'draft.addsAD': 'Adds AD damage',
      'draft.frontline': 'Adds frontline',
      'draft.fitsRole': 'Fits role (no meta yet)',

      'role.TOP': 'Top',
      'role.JUNGLE': 'Jungle',
      'role.MIDDLE': 'Mid',
      'role.BOTTOM': 'Bot',
      'role.UTILITY': 'Support',
      'roleIn.TOP': 'top',
      'roleIn.JUNGLE': 'jungle',
      'roleIn.MIDDLE': 'mid',
      'roleIn.BOTTOM': 'bot',
      'roleIn.UTILITY': 'support',
      'roleIn.ALL': 'overall',

      'footer.patch': 'Patch {patch}',
      'footer.demo': 'DEMO DATA',
      'footer.hide': 'Ctrl+Shift+L to hide',

      'tray.toggle': 'Show/hide overlay',
      'tray.autostart': 'Start with Windows',
      'tray.quit': 'Quit',
    },

    'pt-BR': {
      'app.starting': 'Iniciando...',
      'app.close': 'Fechar overlay',
      'app.language': 'Trocar idioma',
      'app.resize': 'Redimensionar (arraste ou use as setas)',

      'status.loadingData': 'Carregando dados do jogo...',
      'status.waiting': 'Aguardando uma partida...',
      'status.loadingScreen': 'Tela de carregamento...',
      'status.notFound': 'Jogador ativo não encontrado (assistindo?)',
      'status.notInChampSelect': 'Fora da seleção de campeões',
      'status.error': 'Erro: {message}',

      'meta.off': 'Meta: desligada (sem RIOT_API_KEY)',
      'meta.configError': 'Meta: {message}',
      'meta.starting': 'Meta {patch}: iniciando...',
      'meta.progress': 'Meta {patch}: {matches}/{target} partidas',
      'meta.done': 'Meta {patch}: {matches} partidas',
      'meta.badKey': 'Meta: chave da Riot inválida ou expirada',
      'meta.error': 'Erro na meta: {message}',
      'meta.usingOld': '(usando {patch})',
      'meta.games': '({games} partidas de {champion})',

      'game.summary': '{champion} ({archetype}) · {gold}g · Inimigos {ad}% AD / {ap}% AP',
      'game.boots': 'Botas',
      'game.nextItems': 'Próximos itens',
      'game.bootsOwned': 'Já possui',

      'flag.healing': 'Cura',
      'flag.burst': 'Burst',
      'flag.cc': 'Muito controle',
      'flag.crit': 'Crítico',
      'flag.highArmor': 'Muita armadura',
      'flag.highMR': 'Muita RM',
      'flag.heavyAD': 'Muito AD',
      'flag.heavyAP': 'Muito AP',

      'archetype.mage': 'mago',
      'archetype.enchanter': 'encantador',
      'archetype.marksman': 'atirador',
      'archetype.assassin': 'assassino',
      'archetype.fighter': 'lutador',
      'archetype.tank': 'tanque',

      'reason.counter.healing': 'Feridas Dolorosas contra a cura inimiga',
      'reason.counter.burst': 'Sobreviver ao burst inimigo',
      'reason.counter.cc': 'Remover controle de grupo pesado',
      'reason.counter.crit': 'Inimigos acumulando crítico',
      'reason.counter.highArmor': 'Penetração de armadura contra inimigos resistentes',
      'reason.counter.highMR': 'Penetração mágica contra resistência mágica',
      'reason.counter.heavyAD': 'Armadura contra time com muito AD',
      'reason.counter.heavyAP': 'Resistência mágica contra time com muito AP',
      'reason.bootsCC': 'Tenacidade contra muito controle de grupo',
      'reason.bootsDefault': 'Botas padrão para sua função',
      'reason.meta': 'Meta: {pick}% de escolha, {wr}% de vitória',
      'reason.metaPick': 'Meta: {pick}% de escolha',
      'reason.order': 'Meta: {slot}º item em {pick}% das partidas',
      'reason.keystone': 'Combina com {rune}',
      'reason.buildsFrom': 'Aproveita seu {item}',
      'reason.core': 'Atributos principais para {archetype}',

      'draft.title': 'Campeões sugeridos',
      'draft.allies': 'Aliados: {list}',
      'draft.enemies': 'Inimigos: {list}',
      'draft.noneYet': 'nenhum ainda',
      'draft.empty': 'Sem sugestões ainda',
      'draft.base': '{wr}% de vitória {role} ({games} partidas)',
      'draft.vs': '{delta}% contra {name}',
      'draft.with': '{delta}% com {name}',
      'draft.addsAP': 'Adiciona dano AP',
      'draft.addsAD': 'Adiciona dano AD',
      'draft.frontline': 'Adiciona linha de frente',
      'draft.fitsRole': 'Combina com a função (sem meta ainda)',

      'role.TOP': 'Topo',
      'role.JUNGLE': 'Selva',
      'role.MIDDLE': 'Meio',
      'role.BOTTOM': 'Atirador',
      'role.UTILITY': 'Suporte',
      'roleIn.TOP': 'no topo',
      'roleIn.JUNGLE': 'na selva',
      'roleIn.MIDDLE': 'no meio',
      'roleIn.BOTTOM': 'no bot',
      'roleIn.UTILITY': 'como suporte',
      'roleIn.ALL': 'no geral',

      'footer.patch': 'Patch {patch}',
      'footer.demo': 'DADOS DE DEMONSTRAÇÃO',
      'footer.hide': 'Ctrl+Shift+L para ocultar',

      'tray.toggle': 'Mostrar/ocultar overlay',
      'tray.autostart': 'Iniciar com o Windows',
      'tray.quit': 'Sair',
    },
  };

  const LANGUAGES = Object.keys(MESSAGES);
  const LABELS = { en: 'EN', 'pt-BR': 'PT' };

  function formatValue(value, lang) {
    if (typeof value === 'number') return new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value);
    if (value && typeof value === 'object') {
      if ('key' in value) return t(lang, value.key, value.params);
      if ('num' in value) {
        return new Intl.NumberFormat(lang, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
          signDisplay: value.sign ? 'always' : 'auto',
        }).format(value.num);
      }
    }
    return String(value);
  }

  function t(lang, key, params = {}) {
    const template = MESSAGES[lang]?.[key] ?? MESSAGES.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      params && name in params ? formatValue(params[name], lang) : match
    );
  }

  // Translates a { key, params } message object.
  const tm = (lang, msg) => (msg && typeof msg === 'object' ? t(lang, msg.key, msg.params) : String(msg ?? ''));

  const api = { MESSAGES, LANGUAGES, LABELS, t, tm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.i18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
