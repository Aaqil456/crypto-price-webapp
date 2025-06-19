import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// ❌ Buang React.StrictMode untuk elak WebSocket bug masa dev
ReactDOM.createRoot(document.getElementById("root")).render(
  <App />
);
