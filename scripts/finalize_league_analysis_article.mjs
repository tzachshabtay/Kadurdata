import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { finalizeLeagueArticle } from "./content_league_analysis.mjs";
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
try {
  if(!args.includes("--source")||!args.includes("--authored"))throw new Error("Usage: content:finalize:league --source <source.json> --authored <authored.json>");
  const sourcePath=path.resolve(value("--source")),authoredPath=path.resolve(value("--authored"));
  const source=JSON.parse(await readFile(sourcePath,"utf8")),authored=JSON.parse(await readFile(authoredPath,"utf8"));
  const article=finalizeLeagueArticle(source,authored),outputPath=path.join(path.dirname(sourcePath),"candidate.json");
  await writeFile(outputPath,JSON.stringify(article,null,2)+"\n");console.log(JSON.stringify({outputPath,status:article.status,approval:article.approval.status,checks:article.factCheck.checks.length},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
