import { useEffect, useState } from "react";
import { Button, Card } from "../ui";

export function LogPage() {
  const [text, setText] = useState("");
  const load = () => window.matpylon.logTail(300).then(setText);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <Card
      title="로그 (오늘, 마지막 300줄)"
      actions={
        <>
          <Button onClick={load}>새로고침</Button>
          <Button onClick={() => window.matpylon.openLogFolder()}>로그 폴더 열기</Button>
        </>
      }
    >
      <pre className="max-h-[70vh] overflow-auto rounded bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100">
        {text || "아직 로그가 없습니다."}
      </pre>
    </Card>
  );
}
