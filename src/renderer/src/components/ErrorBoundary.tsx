import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportCrash } from '../lib/crashReport'

interface Props {
  children: ReactNode
}
interface State {
  err: Error | null
  stack: string
}

/**
 * Bez tego dowolny błąd renderowania odmontowuje CAŁE drzewo Reacta: #root zostaje pusty,
 * a ponieważ okno jest przezroczyste, użytkownik widzi tylko ciemne tło i nie ma pojęcia,
 * co się stało. Tutaj zamiast czarnego ekranu pokazujemy komunikat i wysyłamy go do logu.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null, stack: '' }

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err }
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' })
    reportCrash('react', `${err.stack ?? err.message}\n--- drzewo ---${info.componentStack ?? ''}`)
  }

  render(): ReactNode {
    const { err, stack } = this.state
    if (!err) return this.props.children
    return (
      <div className="crash-screen">
        <h2>Coś się wywaliło w interfejsie</h2>
        <p>
          Aplikacja działa dalej — poniżej jest błąd. Skopiuj go albo uruchom aplikację
          z terminala, żeby ten sam tekst trafił na stderr.
        </p>
        <pre>{(err.stack || `${err.name}: ${err.message}`) + stack}</pre>
        <button className="notes-btn" onClick={() => this.setState({ err: null, stack: '' })}>
          Spróbuj wrócić
        </button>
      </div>
    )
  }
}
