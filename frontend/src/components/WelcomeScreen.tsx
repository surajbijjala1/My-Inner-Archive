interface WelcomeScreenProps {
  onGetStarted: () => void;
  onLogIn: () => void;
}

/**
 * The first page someone without an account sees. No card: the words are
 * written straight onto the desk, in the lamp's light (DiaryScene, "landing"),
 * and in one hand throughout; only the size changes. What the app does is
 * kept for a later tour in src/tourContent.ts.
 */
export default function WelcomeScreen({ onGetStarted, onLogIn }: WelcomeScreenProps) {
  return (
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
  );
}
