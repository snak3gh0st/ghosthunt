import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Crosshair, TerminalSquare } from "lucide-react";

export default function LoginPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/session", {
        headers: { "x-api-key": key },
      });
      if (!res.ok) throw new Error("Invalid API key");
      localStorage.setItem("ghosthunt_api_key", key);
      const session = await res.json();
      navigate(session.mode === "sales" ? "/sales" : "/");
    } catch {
      setError(
        "Não foi possível entrar. Confira a chave de acesso e se o Ghosthunt está em execução.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bounty-app b-login-scene">
      <form onSubmit={handleSubmit} className="b-login-form b-form">
        <div className="b-login-brand">
          <Crosshair size={36} strokeWidth={1.2} />
          <span className="b-signal-label">
            OPERATOR ACCESS // LOCAL WORKSPACE
          </span>
          <h1 className="b-glitch">Ghosthunt_</h1>
          <p>Seu centro de pesquisa em bug bounty.</p>
        </div>

        <div>
          <label htmlFor="api-key">Chave de acesso</label>
          <input
            id="api-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="ghnt_..."
            required
          />
        </div>

        {error && (
          <p className="b-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="b-button">
          <TerminalSquare size={16} />
          {loading ? "Conferindo…" : "Entrar no workspace"}
        </button>
      </form>
    </div>
  );
}
