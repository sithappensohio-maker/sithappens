import { useState } from "react";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login, register, error, setError } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    if (mode === "login") await login(email, password);
    else await register(email, password, name);
    setLoading(false);
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-bgBase p-4" data-testid="login-screen">
      <div className="absolute inset-0 pointer-events-none opacity-30"
           style={{background:"radial-gradient(circle at 20% 20%, #00a9e0 0%, transparent 40%), radial-gradient(circle at 80% 80%, #8cc63f 0%, transparent 40%)"}} />
      <div className="relative bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-10 shadow-2xl animate-slide-in">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Sit Happens" className="h-32 mx-auto mb-3 drop-shadow-2xl" data-testid="login-logo" />
          <p className="text-[12px] uppercase font-black tracking-[0.3em] text-gray-400 mt-2">Dog Training • Daycare • Boarding</p>
        </div>
        <div className="flex gap-2 mb-6 bg-bgBase rounded-lg p-1">
          <button onClick={() => setMode("login")} data-testid="tab-login"
                  className={`flex-1 py-2 rounded text-[12px] font-black uppercase tracking-widest ${mode==="login"?"bg-shBlue text-white":"text-gray-400"}`}>Sign In</button>
          <button onClick={() => setMode("register")} data-testid="tab-register"
                  className={`flex-1 py-2 rounded text-[12px] font-black uppercase tracking-widest ${mode==="register"?"bg-shBlue text-white":"text-gray-400"}`}>Register</button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Full Name</label>
              <input value={name} onChange={(e)=>setName(e.target.value)} required data-testid="register-name-input"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shBlue outline-none" />
            </div>
          )}
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Email</label>
            <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required data-testid="login-email-input"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shBlue outline-none" />
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Password</label>
            <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required data-testid="login-password-input"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shBlue outline-none" />
          </div>
          {error && <div data-testid="login-error" className="text-[13px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{error}</div>}
          <button type="submit" disabled={loading} data-testid="login-submit-button"
                  className="w-full bg-shBlue text-white py-3 rounded font-black text-[13px] uppercase tracking-widest shadow-lg hover:bg-shBlue/90 disabled:opacity-50">
            {loading?"Please wait...":(mode==="login"?"Sign In":"Create Account")}
          </button>
        </form>
        <p className="mt-6 text-center text-[12px] text-gray-500 uppercase tracking-widest">
          {mode==="login" ? "New client? Register to access the portal." : "Already have an account? Switch to Sign In."}
        </p>
      </div>
    </div>
  );
}
