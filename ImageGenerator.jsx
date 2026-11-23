
import { useState } from "react";

export default function ImageGenerator() {
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generateImage = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError("");
    setImage("");

    try {
      const url =
        "https://image.pollinations.ai/prompt/" +
        encodeURIComponent(prompt.trim());

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Image generation failed. Try again.");
      }

      const blob = await response.blob();
      const imageUrl = URL.createObjectURL(blob);
      setImage(imageUrl);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="image-generator">
      <h2>Chormo AI Image Creator</h2>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the image you want..."
      />

      <button onClick={generateImage} disabled={loading}>
        {loading ? "Creating..." : "Generate Image"}
      </button>

      {error && <p>{error}</p>}

      {image && (
        <div>
          <img
            src={image}
            alt="AI generated"
            style={{ width: "100%", maxWidth: "500px" }}
          />
          <a href={image} download="chormo-ai-image.png">
            Download Image
          </a>
        </div>
      )}
    </div>
  );
}
