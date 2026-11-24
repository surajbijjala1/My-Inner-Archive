interface WelcomeScreenProps {
  onGetStarted: () => void;
  onLogIn: () => void;
}

/**
 * The entry page: the first thing someone without a session sees. Nothing
 * but the words, on the app's own page colour, in one hand throughout; only
 * the size changes. Either button leads to the book (on a cold start, by way
 * of the intro video, which is why this page comes first: the tap is what
 * lets the video play with its sound). What the app does is kept for a later
 * tour in src/tourContent.ts.
 */
export default function WelcomeScreen({ onGetStarted, onLogIn }: WelcomeScreenProps) {
  return (
    <main className="entry-page">
      <div className="landing">
        <h1 className="landing-title">
          <span className="landing-entering">Entering</span>
          <span className="landing-name">My Inner Archive</span>
        </h1>
        <p className="landing-tagline">
          A private space to capture your thoughts and let AI reflect your own wisdom back to you.
        </p>
        <button className="landing-cta" onClick={onGetStarted}>
          Get Started
        </button>
        <button className="landing-login" onClick={onLogIn}>
          already have one? log in
        </button>
        <p className="landing-foot">yours alone, kept private</p>
      </div>
    </main>
  );
}
