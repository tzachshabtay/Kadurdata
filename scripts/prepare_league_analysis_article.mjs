import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { prepareLeagueSource, addLeagueClubComparison } from "./content_league_analysis.mjs";
const args=process.argv.slice(2), value=flag=>args[args.indexOf(flag)+1];
try {
  if (!args.includes("--raw") || !args.includes("--slug")) throw new Error("Usage: content:prepare:league --raw <repository-query.json> --slug <slug> [--output-dir <directory>]");
  const slug=value("--slug"),dir=path.resolve(args.includes("--output-dir")?value("--output-dir"):`.content-workbench/${slug}`),out=path.join(dir,"source.json");
  try { await access(out); throw new Error("Source already exists; preserve it and use another workbench directory."); } catch(error) { if(error.code!=="ENOENT") throw error; }
  let source=prepareLeagueSource(JSON.parse(await readFile(path.resolve(value("--raw")),"utf8")),{slug});
  if (args.includes("--player-names") && !args.includes("--club-names")) throw new Error("Player names require a club comparison.");
  if (args.includes("--club-names")) {
    const names = JSON.parse(await readFile(path.resolve(value("--club-names")), "utf8"));
    const players = args.includes("--player-names") ? JSON.parse(await readFile(path.resolve(value("--player-names")), "utf8")) : {};
    source = addLeagueClubComparison(source, names, players);
  }
  await mkdir(dir,{recursive:true});await writeFile(out,JSON.stringify(source,null,2)+"\n");console.log(JSON.stringify({sourcePath:out,matches:source.summary.matches,groups:source.groups.length},null,2));
} catch(error) { console.error(error.message);process.exitCode=1; }
