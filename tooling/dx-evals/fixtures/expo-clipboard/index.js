let secret
let state

export const configureDxEval = (token, scenario) => {
  if (secret !== undefined) throw new Error("controlled expo-clipboard state already configured")
  secret = token
  state = { scenario, registrations: 0, removals: 0, emitted: 0 }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return {
    registrations: state.registrations,
    removals: state.removals,
    emitted: state.emitted,
  }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-clipboard state is unavailable")
  return state
}

export const ContentType = {
  PLAIN_TEXT: "plain-text",
  HTML: "html",
  IMAGE: "image",
  URL: "url",
}
export const StringFormat = { PLAIN_TEXT: "plainText", HTML: "html" }
export const ClipboardPasteButton = () => null
export const isPasteButtonAvailable = false

export const addClipboardListener = (listener) => {
  const nativeState = control()
  nativeState.registrations += 1
  if (nativeState.scenario === "listener-failure") {
    throw new Error("controlled listener registration failure")
  }
  queueMicrotask(() => {
    for (const contentTypes of [[ContentType.PLAIN_TEXT], [ContentType.IMAGE]]) {
      nativeState.emitted += 1
      listener({ contentTypes })
    }
  })
  return {
    remove() {
      nativeState.removals += 1
    },
  }
}

export const removeClipboardListener = (subscription) => subscription.remove()
export const getStringAsync = async () => "controlled text"
export const setStringAsync = async () => true
export const hasStringAsync = async () => true
export const getUrlAsync = async () => null
export const setUrlAsync = async () => undefined
export const hasUrlAsync = async () => false
export const getImageAsync = async () => null
export const setImageAsync = async () => undefined
export const hasImageAsync = async () => false
