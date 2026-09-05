import { StagingBanner } from './components/StagingBanner'
import { SignIn } from './components/SignIn'
import { AppShell } from './components/AppShell'
import { Reception } from './pages/Reception'
import { useSession } from './lib/useSession'

function App() {
  const { session, loading } = useSession()

  return (
    <>
      <StagingBanner />
      {loading ? null : session ? (
        <AppShell userId={session.user.id} userEmail={session.user.email} section="Reception">
          <Reception userId={session.user.id} />
        </AppShell>
      ) : (
        <SignIn />
      )}
    </>
  )
}

export default App
