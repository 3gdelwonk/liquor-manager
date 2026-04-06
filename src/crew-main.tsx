import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import CrewAppStandalone from './CrewAppStandalone'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrewAppStandalone />
  </StrictMode>,
)
