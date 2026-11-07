import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import './base.css'
import '../shared/ui/controls.css'
import { QualityWorkspace } from '../pages/quality-workspace'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QualityWorkspace />
  </StrictMode>,
)
