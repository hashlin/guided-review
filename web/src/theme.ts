import { registerCustomCSSVariableTheme } from '@pierre/diffs'

export const GR_THEME = 'gr-syntax'

registerCustomCSSVariableTheme(GR_THEME, {
  foreground: '#1D1F23',
  background: '#FFFFFF',
  'token-keyword': '#7C3AAE',
  'token-string': '#2F7D4F',
  'token-comment': '#8A8D93',
  'token-constant': '#B35A00',
  'token-function': '#1E66B8',
  'token-parameter': '#B35A00',
  'token-punctuation': '#6D7078',
  'token-string-expression': '#2F7D4F',
  'token-link': '#1E66B8',
})

export const GR_UNSAFE_CSS = `
:host {
  --diffs-addition-base: var(--gr-addition, #2F7D4F);
  --diffs-deletion-base: var(--gr-deletion, #B4372F);
  --diffs-header-font-family: var(--gr-ui-font, system-ui);
}
`
