/**
 * Delphi model configuration page — the plugin's browser half.
 *
 * Rendered by the DSH Web client from the Plugins page: open
 * **Plugins → @boyingliu01/dsh-plugin-xp-gate → tool-xp-gate → Configure**.
 *
 * Why hand-written CommonJS instead of tsdown: the DSH client module system
 * (`dsh-client-modules`) evaluates exactly this shape — one
 * `window.__ModuleLoader__.load({ id, factory })` call per package, receiving a
 * `require` that resolves the shared platform table (React, Cordis, primitives).
 * A bundler that adds a prelude or exports ESM would register nothing.
 *
 * Contract details worth stating, because a shipped third-party plugin got them
 * wrong and every save failed silently:
 *
 *  - settings writes are `{ op: 'set', path: [name], value }` (`SettingsPathOpView`),
 *    NOT `{ type, key, value }`
 *  - a row's configuration page is keyed `<package name>#<row id>`
 *  - `plugins.item` belongs to the official settings pages, so this registers only
 *    `plugins.row.config`
 *
 * The page cannot import the plugin's host code: `src/delphi.ts` and friends import
 * `node:fs` and `@deepseek-ai/dsh-llm`, neither of which the browser has. The one
 * rule it must agree with — three distinct models — is therefore re-applied here
 * from the same three-seat invariant, and the Host re-checks it on every review
 * run (`seatsFromSettings`), so a disagreement can never leak money.
 */
window.__ModuleLoader__.load({
  id: '@boyingliu01/dsh-plugin-xp-gate',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    /** Plugin package name, and the Loader row id its bundle patch declares. */
    var PKG = '@boyingliu01/dsh-plugin-xp-gate'
    var ROW_ID = 'tool-xp-gate'
    /** The settings namespace is the row id: DSH keys a served form by entry id. */
    var NS = ROW_ID
    /** Dictionary namespace owned by this page. */
    var LOCALE_NS = 'xp-gate-delphi'

    var React = require('react')

    /** Exactly three seats, matching the Delphi invariant the Host enforces. */
    var SEAT_COUNT = 3
    /** The roles xp-gate writes into `.delphi-config.json`; kept as the defaults. */
    var DEFAULT_ROLES = ['architecture', 'technical', 'feasibility']

    var en = {
      summary: 'Choose the three Delphi reviewer models. Saving here overrides .delphi-config.json.',
      seats: 'Reviewer seats',
      seatsHint: 'Exactly three distinct models. A repeated model, or a model shared with another seat, is rejected before any request is sent.',
      seat: 'Seat {n}',
      role: 'Role',
      model: 'Model',
      pickModel: 'Choose from configured providers',
      gateway: 'Gateway',
      gatewayHint: 'OpenAI-compatible base URL, e.g. https://host/gpt-proxy. All seats share it.',
      apiKey: 'API key reference',
      apiKeyHint: 'A credential reference such as ${WHALECLOUD_API_KEY}. A literal key is refused: it would be written to the profile file.',
      consensus: 'Consensus',
      threshold: 'Approval threshold (%)',
      maxRounds: 'Maximum rounds',
      catalogLoading: 'Loading models…',
      catalogFailed: 'Could not load the model catalog.',
      catalogUnavailable: 'No providers configured; type model ids directly.',
      invalid: 'The three seats need three distinct, non-empty models.',
      invalidGateway: 'A gateway URL is required when seats are configured.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The Host did not accept these values.',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      fallbackNote: 'No seats saved here yet, so reviews use .delphi-config.json.',
    }

    var zh = {
      summary: '选择三个 Delphi 评审模型。在此保存会覆盖 .delphi-config.json。',
      seats: '评审席位',
      seatsHint: '必须恰好三个互不相同的模型。重复或与其它席位相同，会在发出任何请求之前被拒绝。',
      seat: '席位 {n}',
      role: '角色',
      model: '模型',
      pickModel: '从已配置的提供方选择',
      gateway: '网关',
      gatewayHint: 'OpenAI 兼容的 base URL，例如 https://host/gpt-proxy。三个席位共用。',
      apiKey: '密钥引用',
      apiKeyHint: '使用凭据引用，如 ${WHALECLOUD_API_KEY}。拒绝明文密钥——它会写进 profile 文件。',
      consensus: '共识',
      threshold: '通过阈值（%）',
      maxRounds: '最大轮次',
      catalogLoading: '正在加载模型…',
      catalogFailed: '无法加载模型目录。',
      catalogUnavailable: '未配置提供方，请直接填写模型 ID。',
      invalid: '三个席位需要三个互不相同的非空模型。',
      invalidGateway: '配置了席位就必填网关地址。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '宿主未接受这些值。',
      readOnly: '本部署的设置是只读的。',
      unavailable: '插件未加载，暂时无法配置。',
      fallbackNote: '这里还没有保存席位上，评审仍使用 .delphi-config.json。',
    }

    /** The active locale's BCP-47 tag, read defensively: a missing API is not an error. */
    function activeLocale(ctx) {
      try {
        var snap = ctx && ctx.locale && ctx.locale.getSnapshot ? ctx.locale.getSnapshot() : null
        if (snap && typeof snap.active === 'string') return snap.active
      } catch (error) {
        console.warn('[xp-gate] locale read failed', error && error.message)
      }
      return ''
    }

    /** Pick the dictionary for the active locale, defaulting to English. */
    function translator(ctx) {
      var dict = activeLocale(ctx).indexOf('zh') === 0 ? zh : en
      return function t(key, params) {
        var text = dict[key] !== undefined ? dict[key] : en[key] !== undefined ? en[key] : key
        if (params) {
          Object.keys(params).forEach(function (name) {
            text = text.split('{' + name + '}').join(String(params[name]))
          })
        }
        return text
      }
    }

    /** One provider group from the Host's catalog, in the shape the select renders. */
    function catalogGroup(group) {
      var models = (group.models || []).map(function (model) { return model.id })
      return { provider: group.id, providerName: group.name, models: models }
    }

    /** The Host's session handle that can list models, or null when unreachable. */
    function catalogSession(ctx) {
      if (!ctx || !ctx.remote || !ctx.remote.session) return null
      return ctx.remote.session
    }

    /**
     * The non-empty provider groups a catalog response offers, or null on failure.
     *
     * Grouping here rather than in the effect keeps the promise handler a
     * two-branch decision: one shape or an error.
     */
    function healthyCatalogGroups(response) {
      if (!response || !response.ok) return null
      var groups = (response.value.groups || []).map(catalogGroup)
      return groups.filter(function (group) { return group.models.length > 0 })
    }

    /**
     * Build the editable draft from the Host's accepted values.
     *
     * Lives outside the component on purpose: the page's effect has to stay a
     * subscription, not a place where six defaulting ternaries live.
     */
    function draftFrom(value) {
      var delphi = (value && value.delphi) || {}
      return {
        seats: seatsOf(delphi),
        baseUrl: delphi.baseUrl || '',
        apiKey: delphi.apiKey || '',
        thresholdPercent: typeof delphi.thresholdPercent === 'number' ? delphi.thresholdPercent : 90,
        maxRounds: typeof delphi.maxRounds === 'number' ? delphi.maxRounds : 5,
      }
    }

    /** One draft seat: the stored strings, with the role defaulting to this seat's slot. */
    function draftSeat(stored, index) {
      var seat = stored || {}
      var role = typeof seat.role === 'string' && seat.role ? seat.role : DEFAULT_ROLES[index]
      return { role: role, model: typeof seat.model === 'string' ? seat.model : '' }
    }

    /** Read a seat list from the section value, always returning exactly three drafts. */
    function seatsOf(value) {
      var stored = value && Array.isArray(value.seats) ? value.seats : []
      var seats = []
      for (var i = 0; i < SEAT_COUNT; i++) seats.push(draftSeat(stored[i], i))
      return seats
    }

    /** Every distinctness rule the Host will re-check, applied to the draft. */
    function validationError(seats, baseUrl) {
      var models = seats.map(function (s) {
        return (s.model || '').trim()
      })
      if (models.some(function (m) { return m === '' })) return 'empty'
      var unique = models.filter(function (m, i) { return models.indexOf(m) === i })
      if (unique.length !== SEAT_COUNT) return 'duplicate'
      if (!baseUrl || !String(baseUrl).trim()) return 'gateway'
      return ''
    }

    /** Build the ordered `mutate` operations one save sends. */
    function saveOperations(draft) {
      var delphi = {
        baseUrl: (draft.baseUrl || '').trim(),
        apiKey: (draft.apiKey || '').trim(),
        seats: draft.seats.map(function (seat, index) {
          return { role: (seat.role || DEFAULT_ROLES[index]).trim(), model: (seat.model || '').trim() }
        }),
        thresholdPercent: Number(draft.thresholdPercent),
        maxRounds: Number(draft.maxRounds),
      }
      // DSH's SettingsPathOpView: path-addressed, one op per field. The whole
      // block is one op so the sections can never be saved half-way.
      return [{ op: 'set', path: ['delphi'], value: delphi }]
    }

    /** A labelled text input. */
    function Field(props) {
      return React.createElement(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 } },
        React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, props.label),
        React.createElement('input', {
          type: 'text',
          value: props.value,
          disabled: props.disabled,
          onChange: function (event) { props.onChange(event.target.value) },
          style: {
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13,
          },
        }),
        props.hint
          ? React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, props.hint)
          : null,
      )
    }

    /** One provider's models as an `<optgroup>`, so the select body stays shallow. */
    function CatalogGroup(props) {
      return React.createElement(
        'optgroup',
        { label: props.group.providerName },
        props.group.models.map(function (model) {
          return React.createElement('option', { key: model, value: model }, model)
        }),
      )
    }

    /**
     * The catalog picker beside the model text input.
     *
     * Blank means "keep whatever was typed": an empty option is only the initial
     * state, and selecting it must not clear a model the operator pinned by hand.
     */
    function CatalogPicker(props) {
      if (props.catalogs.length === 0) return null
      return React.createElement(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        React.createElement(
          'span',
          { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
          props.t('pickModel'),
        ),
        React.createElement(
          'select',
          {
            value: props.value,
            disabled: props.disabled,
            onChange: function (event) {
              if (event.target.value) props.onChange(event.target.value)
            },
            style: {
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-2)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 13,
              maxWidth: 260,
            },
          },
          React.createElement('option', { value: '' }, '—'),
          props.catalogs.map(function (group) {
            return React.createElement(CatalogGroup, { key: group.provider, group: group })
          }),
        ),
      )
    }

    /** Render one seat row: role, model text input, and a catalog select when available. */
    function SeatRow(props) {
      var seat = props.seat
      return React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'flex-end', padding: '4px 0' } },
        React.createElement(Field, {
          label: props.t('role'),
          value: seat.role,
          disabled: props.disabled,
          onChange: function (v) { props.onChange('role', v) },
        }),
        React.createElement(Field, {
          label: props.t('model'),
          value: seat.model,
          disabled: props.disabled,
          onChange: function (v) { props.onChange('model', v) },
        }),
        React.createElement(CatalogPicker, {
          t: props.t,
          value: seat.model,
          disabled: props.disabled,
          catalogs: props.catalogs,
          onChange: function (v) { props.onChange('model', v) },
        }),
      )
    }

    /**
     * The page's section list, in render order.
     *
     * Split out of the component so the component stays a state machine — the
     * markup is a pure function of the draft and the flags, which is also what
     * makes it readable without scrolling through a hook order.
     */
    function pageSections(f) {
      var t = f.t
      var children = []

      if (!f.writable) children.push(React.createElement('p', { key: 'ro', role: 'status' }, t('readOnly')))
      children.push(
        React.createElement(
          'p',
          { key: 'sum', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
          t('summary'),
        ),
      )
      if (f.noSeats) {
        children.push(React.createElement('p', { key: 'fb', style: { fontSize: 12 } }, t('fallbackNote')))
      }

      children.push(React.createElement(seatsSection, { key: 'seats', f: f }))
      children.push(React.createElement(gatewaySection, { key: 'gateway', f: f }))
      children.push(React.createElement(consensusSection, { key: 'consensus', f: f }))

      if (f.problem && !f.noSeats) {
        var message = f.problem === 'gateway' ? t('invalidGateway') : t('invalid')
        children.push(errorLine('inv', message))
      }
      if (f.failed) children.push(errorLine('fail', t('saveFailed')))

      children.push(React.createElement(saveAction, { key: 'actions', f: f }))
      return children
    }

    /** One red line of form feedback. */
    function errorLine(key, message) {
      var style = { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }
      return React.createElement('p', { key: key, role: 'alert', style: style }, message)
    }

    /** The three seat editors plus the catalog failure note. */
    function seatsSection(props) {
      var f = props.f
      var t = f.t
      return React.createElement(
        'section',
        null,
        React.createElement('h4', { style: { margin: '12px 0 4px', fontSize: 13 } }, t('seats')),
        React.createElement(
          'p',
          { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', margin: 0 } },
          t('seatsHint'),
        ),
        f.draft.seats.map(function (seat, index) {
          return React.createElement(SeatRow, {
            key: index,
            t: t,
            seat: seat,
            catalogs: f.catalogs,
            disabled: f.disabled,
            onChange: function (key, value) { f.editSeat(index, key, value) },
          })
        }),
        f.catalogs.length === 0 && f.catalogError
          ? React.createElement('p', { style: { fontSize: 12 } }, t('catalogFailed'))
          : null,
      )
    }

    /** Gateway URL and the api key reference. */
    function gatewaySection(props) {
      var f = props.f
      var t = f.t
      return React.createElement(
        'section',
        { style: { display: 'flex', gap: 8, marginTop: 12 } },
        React.createElement(Field, {
          label: t('gateway'),
          value: f.draft.baseUrl,
          hint: t('gatewayHint'),
          disabled: f.disabled,
          onChange: function (v) { f.editField('baseUrl', v) },
        }),
        React.createElement(Field, {
          label: t('apiKey'),
          value: f.draft.apiKey,
          hint: t('apiKeyHint'),
          disabled: f.disabled,
          onChange: function (v) { f.editField('apiKey', v) },
        }),
      )
    }

    /** Consensus threshold and the round cap. */
    function consensusSection(props) {
      var f = props.f
      var t = f.t
      return React.createElement(
        'section',
        { style: { display: 'flex', gap: 8, marginTop: 12 } },
        React.createElement(Field, {
          label: t('threshold'),
          value: String(f.draft.thresholdPercent),
          disabled: f.disabled,
          onChange: function (v) { f.editField('thresholdPercent', v) },
        }),
        React.createElement(Field, {
          label: t('maxRounds'),
          value: String(f.draft.maxRounds),
          disabled: f.disabled,
          onChange: function (v) { f.editField('maxRounds', v) },
        }),
      )
    }

    /** The single save button; disabled while a write is not possible. */
    function saveAction(props) {
      var f = props.f
      var t = f.t
      var blockedStyle = {
        padding: '6px 14px',
        borderRadius: 8,
        border: '1px solid transparent',
        cursor: f.writing ? 'not-allowed' : 'pointer',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-brand-primary-invert, #fff)',
        fontSize: 13,
        opacity: f.writing ? 0.6 : 1,
      }
      return React.createElement(
        'div',
        { style: { marginTop: 12 } },
        React.createElement(
          'button',
          { type: 'button', disabled: f.writing, onClick: f.save, style: blockedStyle },
          f.saving ? t('saving') : t('save'),
        ),
      )
    }

    /**
     * The three "nothing to show yet" states, decided once.
     *
     * `refused` carries the element to render; the caller returns it verbatim.
     */
    function pageGate(t, scope, snapshot, draft) {
      if (!scope) return { refused: React.createElement('p', null, t('unavailable')) }
      if (snapshot && snapshot.status === 'unavailable') {
        return { refused: React.createElement('p', { role: 'status' }, t('unavailable')) }
      }
      if (!draft) return { refused: React.createElement('p', { role: 'status' }, t('catalogLoading')) }
      return { refused: null }
    }

    /** Subscribe to the Host's accepted values and seed the draft from them. */
    function useDraftSubscription(scope, setSnapshot, setDraft) {
      React.useEffect(
        function () {
          if (!scope) return function () {}
          var cancelled = false
          function sync() {
            var next = scope.getSnapshot()
            if (cancelled) return
            setSnapshot(next)
            setDraft(function (current) {
              // Never clobber what the user is typing: seed once, and re-seed only
              // after a save lands (current === null).
              if (current !== null) return current
              return draftFrom(next && next.value)
            })
          }
          sync()
          var unsubscribe = scope.subscribe ? scope.subscribe(sync) : null
          return function () {
            cancelled = true
            if (typeof unsubscribe === 'function') unsubscribe()
          }
        },
        [scope],
      )
    }

    /** Offer the Host's configured models, grouped by provider, when reachable. */
    function useCatalogSubscription(ctx, setCatalogs, setCatalogError) {
      React.useEffect(
        function () {
          var cancelled = false
          var session = catalogSession(ctx)
          if (!session) return function () {}
          Promise.resolve(session.modelCatalog())
            .then(function (response) {
              if (cancelled) return
              var groups = healthyCatalogGroups(response)
              if (!groups) setCatalogError('failed')
              else setCatalogs(groups)
            })
            .catch(function () {
              if (!cancelled) setCatalogError('failed')
            })
          return function () {
            cancelled = true
          }
        },
        [ctx],
      )
    }

    /** One seat updated in place: the edited key replaced, the other kept. */
    function withSeatEdit(seats, index, key, value) {
      var next = seats.slice()
      var edited = Object.assign({}, next[index])
      edited[key] = value
      next[index] = edited
      return next
    }

    /** Hand the action handlers live getters, so a save always reads current state. */
    function pageActionParams(state, scope, facts) {
      return {
        setDraft: state.setDraft,
        setFailed: state.setFailed,
        setSaving: state.setSaving,
        getScope: function () { return scope },
        getDraft: function () { return state.draft },
        getSnapshot: function () { return state.snapshot },
        getSaving: function () { return state.saving },
        getDisabled: function () { return facts.disabled },
        getNoSeats: function () { return facts.noSeats },
        getProblem: function () { return facts.problem },
      }
    }

    /** The props the section list renders from. */
    function pageSectionProps(t, state, facts, actions) {
      return {
        t: t,
        draft: state.draft,
        catalogs: state.catalogs,
        catalogError: state.catalogError,
        disabled: facts.disabled,
        writing: facts.disabled || Boolean(facts.problem),
        noSeats: facts.noSeats,
        writable: facts.writable,
        problem: facts.problem,
        failed: state.failed,
        saving: state.saving,
        editSeat: actions.editSeat,
        editField: actions.editField,
        save: actions.save,
      }
    }

    /**
     * Why a save cannot proceed, or null when it can.
     *
     * Two distinct refusals: `busy` (already saving, or the form is read-only)
     * is silent, anything else is the operator's error and gets a banner.
     */
    function saveRefused(params) {
      if (!params.getScope() || params.getSaving() || params.getDisabled()) return 'busy'
      // A form with no seats has nothing to save: clearing seats is what makes
      // the JSON file apply again, and that is an explicit act, not a blank save.
      if (params.getNoSeats() || params.getProblem()) return 'invalid'
      return null
    }

    /** POST the draft and reconcile the form with what the Host accepted. */
    function commitDraft(params) {
      var snapshot = params.getSnapshot()
      params.setSaving(true)
      params.setFailed(false)
      Promise.resolve(params.getScope().mutate(saveOperations(params.getDraft()), snapshot ? snapshot.revision : undefined))
        .then(function (accepted) {
          if (!accepted) params.setFailed(true)
          else params.setDraft(null)
        })
        .catch(function (error) {
          console.error('[xp-gate] delphi save failed', error)
          params.setFailed(true)
        })
        .then(function () {
          params.setSaving(false)
        })
    }

    /**
     * The page's mutation handlers and the save sequence.
     *
     * Busy and invalid are separate refusals: one is "do nothing", the other is
     * "tell the user why". Folding them into one predicate is what made the
     * handler a nest of early returns.
     */
    function pageActions(params) {
      /** Apply a draft change and drop any stale "save failed" banner with it. */
      function amend(change) {
        params.setFailed(false)
        params.setDraft(function (current) {
          return Object.assign({}, current, change(current))
        })
      }

      function editSeat(index, key, value) {
        amend(function (current) {
          return { seats: withSeatEdit(current.seats, index, key, value) }
        })
      }

      function editField(key, value) {
        amend(function () {
          return { [key]: value }
        })
      }

      function save() {
        var refusal = saveRefused(params)
        if (refusal === null) commitDraft(params)
        else if (refusal === 'invalid') params.setFailed(true)
      }

      return { editSeat: editSeat, editField: editField, save: save }
    }

    /** The six pieces of state the page keeps, unwrapped for readability. */
    function usePageState() {
      var snapshotState = React.useState(null)
      var draftState = React.useState(null)
      var catalogsState = React.useState([])
      var catalogErrorState = React.useState('')
      var savingState = React.useState(false)
      var failedState = React.useState(false)
      return {
        snapshot: snapshotState[0],
        draft: draftState[0],
        setDraft: draftState[1],
        setSnapshot: snapshotState[1],
        catalogs: catalogsState[0],
        setCatalogs: catalogsState[1],
        catalogError: catalogErrorState[0],
        setCatalogError: catalogErrorState[1],
        saving: savingState[0],
        setSaving: savingState[1],
        failed: failedState[0],
        setFailed: failedState[1],
      }
    }

    /** The page's derived flags: is the form writable, and what is wrong with it. */
    function pageFacts(state) {
      var draft = state.draft
      var writable = state.snapshot ? state.snapshot.writable !== false : false
      return {
        writable: writable,
        problem: validationError(draft.seats, draft.baseUrl),
        disabled: !writable || state.saving,
        noSeats: !draft.seats.some(function (seat) { return (seat.model || '').trim() }),
      }
    }

    /** The configuration page: seat editors, gateway, and one save. */
    function DelphiConfigPage(props) {
      var t = props.t
      var scope = props.scope
      var state = usePageState()

      useDraftSubscription(scope, state.setSnapshot, state.setDraft)
      useCatalogSubscription(props.ctx, state.setCatalogs, state.setCatalogError)

      var gate = pageGate(t, scope, state.snapshot, state.draft)
      if (gate.refused) return gate.refused

      var facts = pageFacts(state)
      var actions = pageActions(pageActionParams(state, scope, facts))
      var children = pageSections(pageSectionProps(t, state, facts, actions))
      return React.createElement('div', { style: { padding: '4px 0 8px' } }, children)
    }

    /**
     * What the page renders for a slot dispatch.
     *
     * `summary` is the row's one-liner when the package declares no description;
     * `page` is the configuration form.
     */
    /**
     * The Host's live settings scope for this plugin, or null.
     *
     * A Host without the forms service is not a failure: the page then renders
     * its "read-only / unavailable" branch instead of throwing at mount.
     */
    function configScope(ctx) {
      if (!ctx || !ctx.configForms || typeof ctx.configForms.get !== 'function') return null
      try {
        return ctx.configForms.get(NS)
      } catch (error) {
        console.warn('[xp-gate] configForms.get failed', error && error.message)
        return null
      }
    }

    function DelphiConfigEntry(props) {
      var ctx = props.ctx
      var t = props.t || translator(ctx)
      if (props.view === 'summary') return t('summary')
      return React.createElement(DelphiConfigPage, { ctx: ctx, t: t, scope: configScope(ctx) })
    }

    module.exports.inject = ['slots', 'locale', 'configForms']
    module.exports.NS = NS
    module.exports.PKG = PKG
    module.exports.ROW_ID = ROW_ID
    module.exports.saveOperations = saveOperations
    module.exports.seatsOf = seatsOf
    module.exports.validationError = validationError

    /**
     * Mount the page.
     *
     * Registered on `plugins.row.config` only. The page's lifetime follows the
     * Loader row, so switching the row off removes the page with it.
     */
    module.exports.apply = function apply(ctx) {
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return ctx.locale.register(LOCALE_NS, { en: en, zh: zh })
        }, 'xp-gate: dictionaries')
      }
      if (!ctx.slots || typeof ctx.slots.inject !== 'function') return
      ctx.slots.inject('plugins.row.config', function () {
        return ctx.slots.register(
          { name: 'plugins.row.config', key: PKG + '#' + ROW_ID, locale: LOCALE_NS },
          DelphiConfigEntry,
        )
      })
    }

    return module.exports
  },
})
