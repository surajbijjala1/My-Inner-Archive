export default function MdText({ text }: { text: string }) {
  return (
    <div>
      {text.split(/\n\n+/).map((para, pi) => (
        <p key={pi} style={{ margin: pi === 0 ? 0 : "10px 0 0", lineHeight: 1.7, fontSize: "13.5px" }}>
          {para.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((part, i) => {
            if (part.startsWith("**") && part.endsWith("**"))
              return <strong key={i}>{part.slice(2, -2)}</strong>;
            if (part.startsWith("*") && part.endsWith("*"))
              return <em key={i}>{part.slice(1, -1)}</em>;
            return part.split("\n").map((l, li, a) => (
              <span key={li}>
                {l}
                {li < a.length - 1 && <br />}
              </span>
            ));
          })}
        </p>
      ))}
    </div>
  );
}
