import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary, { CrashFallback } from './components/ErrorBoundary'
import { getRememberedUsername } from './api'
import { hasDraft } from './draft'
import { installGlobalErrorHandlers } from './errorLog'
import './index.css'

installGlobalErrorHandlers()

/**
 * The last line of defence: something broke that no area boundary inside the
 * app could contain. "try again" redraws the app from scratch (it reloads your
 * journal from the server) without a full page reload; "reload" is the bigger
 * hammer. The wording only promises what is true: saved entries live on the
 * server, and an unsent draft is safe only if it made it into local storage.
 */
function rootFallback(retry: () => void) {
  const draftKept = hasDraft(getRememberedUsername())
  return (
    <CrashFallback
      variant="page"
      title="this page came apart"
      actions={[
        { label: 'reload', onClick: () => window.location.reload() },
        { label: 'back to the journal', onClick: retry, primary: true },
      ]}
    >
      Something went wrong while drawing the page, and it had to stop. Entries you have already
      saved are stored on the server and are not affected.{' '}
      {draftKept
        ? 'The page you were in the middle of writing is kept on this device and will be waiting for you.'
        : 'Anything you had typed but not yet sent — a chat message, a setting — may need typing again.'}
    </CrashFallback>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary area="app" fallback={rootFallback}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
