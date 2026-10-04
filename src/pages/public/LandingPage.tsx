import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../../app/BrandMark'
import { useAuth } from '../../auth/AuthContext'

/** Sections fade in once as they scroll into view. */
function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

const CONCEPTS = [
  {
    title: 'Qubit',
    text: 'The basic unit of quantum information. Like a bit it has two basis states, |0⟩ and |1⟩, but it can also be in a combination of both.',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5v17" />
        <circle cx="12" cy="3.5" r="1.6" className="fill" />
      </>
    ),
  },
  {
    title: 'Superposition',
    text: 'A qubit can hold a weighted mix of |0⟩ and |1⟩, such as |+⟩. The Bloch sphere shows every such state as a point on a sphere.',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <ellipse cx="12" cy="12" rx="8.5" ry="3.2" />
        <path d="M12 12l6-5" />
      </>
    ),
  },
  {
    title: 'Quantum gates',
    text: 'Gates rotate a qubit’s state. X flips |0⟩ and |1⟩, H creates superposition, Z changes the phase and CNOT acts on two qubits.',
    icon: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M2 12h4M18 12h4M10 10l4 4M14 10l-4 4" />
      </>
    ),
  },
  {
    title: 'Measurement',
    text: 'Measuring a qubit gives 0 or 1 at random, with probabilities set by its state. Repeating it many times (shots) reveals those probabilities.',
    icon: (
      <>
        <path d="M3 20h18" />
        <rect x="5" y="11" width="4" height="9" rx="1" />
        <rect x="10" y="7" width="4" height="13" rx="1" />
        <rect x="15" y="13" width="4" height="7" rx="1" />
      </>
    ),
  },
]

const STEPS = [
  {
    title: 'Wire the circuit',
    text: 'Patch virtual banana cables from an initial state through a gate to the output, exactly as on the hardware kit.',
  },
  {
    title: 'Watch the state',
    text: 'The Bloch sphere shows the input state as soon as it is connected, then moves to the result when the gate output is wired.',
  },
  {
    title: 'Measure',
    text: 'Run shots and compare the measured counts with the theoretical probabilities on a bar graph.',
  },
]

const LABS = [
  {
    name: 'Bloch Sphere Lab',
    gates: 'X · H · Z',
    points: [
      'How X flips |0⟩ and |1⟩ — a half turn about the X axis',
      'How H creates the superpositions |+⟩ and |−⟩',
      'Why Z changes the phase but not the Bloch point of |0⟩ and |1⟩',
      'Reading a qubit’s state from its Bloch vector',
    ],
  },
  {
    name: 'Measurement Lab',
    gates: 'H · CNOT',
    points: [
      'Why measuring |+⟩ gives 0 and 1 about equally often',
      'How measured counts approach the probabilities as shots increase',
      'The CNOT truth table: the target flips when the control is |1⟩',
      'Single-qubit versus two-qubit measurement outcomes',
    ],
  },
]

const FACTS = [
  { value: '2', label: 'Labs — Bloch Sphere and Measurement' },
  { value: '5', label: 'Guided experiments' },
  { value: '1:1', label: 'Same logic as the hardware kit' },
  { value: 'SAKEC', label: 'Open to students with an @sakec.ac.in email' },
]

/** Lab preview for the hero: a Bloch sphere showing H|0⟩ = |+⟩ and the matching measurement bars. */
function HeroPreview() {
  return (
    <div className="hero-preview" aria-hidden>
      <div className="hero-preview-head">
        <span>Bloch sphere</span>
        <code>H|0⟩ = |+⟩</code>
      </div>
      <svg viewBox="0 0 220 200" className="hero-sphere">
        <circle cx="110" cy="100" r="78" className="hs-outline" />
        <path d="M32 100 A78 24 0 0 1 188 100" className="hs-back" />
        <path d="M32 100 A78 24 0 0 0 188 100" className="hs-front" />
        <line x1="110" y1="12" x2="110" y2="188" className="hs-axis" />
        <line x1="20" y1="100" x2="200" y2="100" className="hs-axis" />
        <path d="M110 22 A78 78 0 0 0 60 120" className="hs-path" />
        <line x1="110" y1="100" x2="60" y2="120" className="hs-vector" />
        <circle cx="60" cy="120" r="5" className="hs-tip" />
        <text x="118" y="16" className="hs-label">|0⟩</text>
        <text x="118" y="196" className="hs-label">|1⟩</text>
        <text x="30" y="140" className="hs-label strong">|+⟩</text>
      </svg>
      <div className="hero-bars">
        {[
          ['|0⟩', 49.6],
          ['|1⟩', 50.4],
        ].map(([label, pct]) => (
          <div key={label as string} className="hero-bar">
            <span className="mono">{label}</span>
            <span className="hero-bar-track">
              <span style={{ width: `${pct}%` }} />
            </span>
            <span className="mono">{(pct as number).toFixed(1)}%</span>
          </div>
        ))}
        <span className="hero-bars-note">1000 shots</span>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const { session } = useAuth()
  const dashboard = session?.role === 'admin' ? '/admin' : '/student'
  const start = session ? dashboard : '/login'
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const toTop = (e: React.MouseEvent) => {
    e.preventDefault()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="home">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`home-top ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="home-wrap home-top-inner">
          <a href="#home" className="brand" onClick={toTop} aria-label="Quantum Logic and Measurement Emulator — home">
            <BrandMark />
            <span className="brand-text">
              <span className="brand-title">Quantum Logic and Measurement Emulator</span>
            </span>
          </a>
          <nav className="home-nav" aria-label="Main">
            <a href="#home" className="home-nav-link" aria-current="page" onClick={toTop}>
              Home
            </a>
            <Link to={start} className="btn btn-primary home-nav-cta">
              {session ? 'Go to dashboard' : 'Get Started'}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* ------------------------------------------------------------ hero */}
        <section id="home" className="home-hero">
          <div className="home-wrap home-hero-grid">
            <Reveal className="home-hero-copy">
              <span className="home-eyebrow">Virtual Quantum Development Kit · SAKEC</span>
              <h1>
                Learn quantum logic <span>by wiring it.</span>
              </h1>
              <p>
                A virtual laboratory that mirrors the physical kit: patch banana cables from initial states through quantum
                gates, then watch the qubit on a Bloch sphere and measure it shot by shot.
              </p>
              <div className="home-hero-actions">
                <Link to={start} className="btn btn-primary btn-lg">
                  {session ? 'Go to dashboard' : 'Get Started'}
                </Link>
                <a href="#learn" className="btn btn-lg">
                  See what you’ll learn
                </a>
              </div>
              {session && (
                <p className="home-signed-in">
                  Signed in as <strong>{session.displayName}</strong>
                </p>
              )}
            </Reveal>
            <Reveal delay={0.1}>
              <HeroPreview />
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------------ what is quantum */}
        <section id="quantum" className="home-section">
          <div className="home-wrap">
            <Reveal className="home-head">
              <span className="home-eyebrow">The basics</span>
              <h2>What is quantum computing?</h2>
              <p>
                Classical computers work with bits that are either 0 or 1. Quantum computers use qubits, which follow the rules of
                quantum mechanics and can represent information in ways a classical bit cannot.
              </p>
            </Reveal>
            <div className="concept-grid">
              {CONCEPTS.map((c, i) => (
                <Reveal key={c.title} className="concept-card" delay={i * 0.06}>
                  <svg viewBox="0 0 24 24" className="concept-icon" aria-hidden>
                    {c.icon}
                  </svg>
                  <h3>{c.title}</h3>
                  <p>{c.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ what you'll learn */}
        <section id="learn" className="home-section alt">
          <div className="home-wrap">
            <Reveal className="home-head">
              <span className="home-eyebrow">The experiments</span>
              <h2>What you’ll learn</h2>
              <p>Each session follows the same three steps as the hardware kit in the lab.</p>
            </Reveal>
            <div className="step-row">
              {STEPS.map((s, i) => (
                <Reveal key={s.title} className="step-card" delay={i * 0.08}>
                  <span className="step-num">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </Reveal>
              ))}
            </div>
            <div className="outcome-grid">
              {LABS.map((lab, i) => (
                <Reveal key={lab.name} className="outcome-card" delay={i * 0.08}>
                  <header>
                    <h3>{lab.name}</h3>
                    <span className="outcome-gates">{lab.gates}</span>
                  </header>
                  <ul>
                    {lab.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ about */}
        <section id="about" className="home-section">
          <div className="home-wrap about-grid">
            <Reveal className="about-copy">
              <span className="home-eyebrow">About us</span>
              <h2>About the project</h2>
              <p>
                The Quantum Logic and Measurement Emulator started as a physical teaching kit at Shah &amp; Anchor Kutchhi
                Engineering College (SAKEC). Students wire banana-jack cables from initial states through X, H, Z and CNOT
                gates, and an ESP32-S3 controller shows the result on a 2.8-inch TFT display as a Bloch sphere or a probability
                graph.
              </p>
              <p>
                This software is the kit’s virtual twin. It follows the same logic as the hardware, so students can prepare
                before a lab session, repeat experiments at their own pace and keep a record of their progress.
              </p>
            </Reveal>
            <Reveal delay={0.1}>
              <dl className="fact-list">
                {FACTS.map((f) => (
                  <div key={f.label}>
                    <dt>{f.value}</dt>
                    <dd>{f.label}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------------ call to action */}
        <section className="home-cta">
          <div className="home-wrap">
            <Reveal className="home-cta-box">
              <div>
                <h2>Ready to wire your first circuit?</h2>
                <p>Sign in with your SAKEC account, or create one with your @sakec.ac.in email.</p>
              </div>
              <Link to={start} className="btn btn-primary btn-lg">
                {session ? 'Go to dashboard' : 'Get Started'}
              </Link>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="home-foot">
        <div className="home-wrap home-foot-inner">
          <span>© {new Date().getFullYear()} Quantum Logic and Measurement Emulator · SAKEC</span>
          <nav aria-label="Footer">
            <a href="#home" onClick={toTop}>
              Home
            </a>
            <a href="#about">About us</a>
            <Link to={start}>{session ? 'Dashboard' : 'Get Started'}</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
