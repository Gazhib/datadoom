import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import './base.css'
import '../shared/ui/controls.css'
import { LocaleProvider } from '../shared/i18n/LocaleProvider'
import { QualityWorkspace } from '../pages/quality-workspace'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <QualityWorkspace />
    </LocaleProvider>
  </StrictMode>,
)
