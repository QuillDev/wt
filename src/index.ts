#!/usr/bin/env bun
import { cancel, confirm, intro, isCancel, outro, select, spinner } from "@clack/prompts";
import pc from "picocolors";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";

type ActionConfig = Record<string, { command?: string }>;

const home = process.env.HOME ?? "";
const wtHome = process.env.WT_HOME ?? join(home, ".wt");
const wtWorktreesDir = process.env.WT_WORKTREES_DIR ?? join(wtHome, "worktrees");

class WtError extends Error {}

const pink = pc.magentaBright;
const muted = pc.gray;

type HelpRow = {
  command: string;
  args?: string;
  description: string;
};

const helpRows: HelpRow[] = [
  { command: "new", args: "[--base REF] [--no-fetch] NAME", description: "Create a managed worktree" },
  { command: "list", args: "[--all]", description: "Show managed worktrees" },
  { command: "open", args: "[NAME|PATH]", description: "Open a worktree in Cursor" },
  { command: "run", args: "ACTION", description: "Run an action in the current repo" },
  { command: "run", args: "NAME|PATH ACTION", description: "Run an action in another worktree" },
  { command: "archive", args: "[--force] NAME|PATH", description: "Remove a managed worktree" },
];

function helpLine({ command, args, description }: HelpRow, width: number): string {
  const plain = `wt ${command}${args ? ` ${args}` : ""}`;
  const styled = `${muted("wt")} ${pink(command)}${args ? ` ${muted(args)}` : ""}`;
  return `  ${styled}${" ".repeat(width - plain.length)}  ${description}`;
}

function helpSection(label: string): string {
  return pink(label.toUpperCase());
}

function usage(): string {
  const commandWidth = Math.max(...helpRows.map(({ command, args }) => `wt ${command}${args ? ` ${args}` : ""}`.length));
  const title = `${pc.bgMagenta(pc.black(" wt "))} ${pc.bold("Git worktrees, kept close")}`;
  const actionPath = `${muted("<base-repo>")}/${pink(".wt/actions.json")}`;

  return [
    "",
    title,
    muted("Small Bun CLI for making, opening, and running Git worktrees."),
    "",
    helpSection("Commands"),
    ...helpRows.map((row) => helpLine(row, commandWidth)),
    "",
    helpSection("Storage"),
    `  ${muted("worktrees")}  ${pink("~/.wt/worktrees")}/${muted("<project-name>/<worktree-name>")}`,
    `  ${muted("actions")}    ${actionPath}`,
    "",
    helpSection("Examples"),
    `  ${muted("$")} wt ${pink("new")} ${muted("--base origin/main")} nako-haru-7188`,
    `  ${muted("$")} wt ${pink("run")} ${muted("nako-haru-7188 dev")}`,
    `  ${muted("$")} wt ${pink("archive")} ${muted("--force nako-haru-7188")}`,
  ].join("\n");
}

function fail(message: string): never {
  throw new WtError(message);
}

function runBin(
  bin: string,
  args: string[],
  options: { cwd?: string; inherit?: boolean; allowFail?: boolean } = {},
): string {
  const proc = Bun.spawnSync([bin, ...args], {
    cwd: options.cwd,
    stdout: options.inherit ? "inherit" : "pipe",
    stderr: options.inherit ? "inherit" : "pipe",
    stdin: "inherit",
  });

  if (proc.exitCode !== 0 && !options.allowFail) {
    const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr).trim() : "";
    fail(stderr || `${bin} ${args.join(" ")} failed`);
  }

  return proc.stdout ? new TextDecoder().decode(proc.stdout).trimEnd() : "";
}

function git(args: string[], cwd = process.cwd(), options: { inherit?: boolean; allowFail?: boolean } = {}): string {
  return runBin("git", args, { cwd, ...options });
}

function isGitRepo(cwd = process.cwd()): boolean {
  const proc = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exitCode === 0;
}

function requireGitRepo(cwd = process.cwd()): void {
  if (!isGitRepo(cwd)) fail("must be run inside a git repository");
}

function repoRoot(cwd = process.cwd()): string {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

function gitCommonDir(cwd = process.cwd()): string {
  return git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
}

function baseRepoRoot(cwd = process.cwd()): string {
  const root = repoRoot(cwd);
  const common = gitCommonDir(cwd);
  return common.endsWith("/.git") ? dirname(common) : root;
}

function projectName(cwd = process.cwd()): string {
  return baseRepoRoot(cwd).split("/").filter(Boolean).at(-1) ?? "project";
}

function refExists(ref: string, cwd = process.cwd()): boolean {
  const proc = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", ref], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exitCode === 0;
}

function defaultBaseRef(cwd = process.cwd()): string {
  for (const remote of ["origin", "upstream"]) {
    if (refExists(`refs/remotes/${remote}/HEAD`, cwd)) {
      const ref = git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], cwd, {
        allowFail: true,
      });
      if (ref && refExists(ref, cwd)) return ref;
    }
  }

  for (const ref of [
    "origin/develop",
    "origin/main",
    "origin/master",
    "upstream/develop",
    "upstream/main",
    "upstream/master",
    "develop",
    "main",
    "master",
  ]) {
    if (refExists(ref, cwd)) return ref;
  }

  fail("could not determine a base ref; pass --base REF");
}

function validateWorktreeName(name: string): void {
  if (!name) fail("missing worktree name");
  if (isAbsolute(name)) fail("worktree name must not be an absolute path");
  if (name.startsWith(".") || name.includes("/.")) fail("worktree name must not contain hidden path components");

  const proc = Bun.spawnSync(["git", "check-ref-format", "--branch", name], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (proc.exitCode !== 0) fail(`invalid git branch name: ${name}`);
}

function walkManagedWorktrees(scope?: string): string[] {
  const base = scope ? join(wtWorktreesDir, scope) : wtWorktreesDir;
  if (!existsSync(base)) return [];

  const out: string[] = [];
  const stack = [base];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (existsSync(join(current, ".git"))) {
      out.push(current);
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(join(current, entry.name));
    }
  }

  return out.sort();
}

function worktreeName(path: string, project?: string): string {
  const prefix = project ? join(wtWorktreesDir, project) : wtWorktreesDir;
  return relative(prefix, path);
}

function worktreeBranch(path: string): string {
  const branch = git(["branch", "--show-current"], path, { allowFail: true });
  return branch || git(["rev-parse", "--short", "HEAD"], path, { allowFail: true }) || "unknown";
}

function resolveWorktree(target?: string): string {
  if (!target) {
    requireGitRepo();
    return repoRoot();
  }

  if (existsSync(target) && lstatSync(target).isDirectory()) {
    return realpathSync(resolve(target));
  }

  if (isGitRepo()) {
    const project = projectName();
    const candidate = join(wtWorktreesDir, project, target);
    if (existsSync(candidate)) return realpathSync(candidate);
  }

  const matches = walkManagedWorktrees().filter((path) => {
    const rel = relative(wtWorktreesDir, path);
    const [, ...nameParts] = rel.split("/");
    return nameParts.join("/") === target || rel === target;
  });

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) fail(`worktree not found: ${target}`);
  fail(`multiple worktrees named '${target}'; run from the project repo or pass a path`);
}

function actionsFileForPath(path: string): string {
  return join(baseRepoRoot(path), ".wt", "actions.json");
}

function readActions(path: string): ActionConfig {
  const file = actionsFileForPath(path);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as ActionConfig;
}

function actionNames(path: string): string[] {
  return Object.entries(readActions(path))
    .filter(([, value]) => typeof value.command === "string" && value.command.length > 0)
    .map(([name]) => name)
    .sort();
}

async function runAction(path: string, action: string): Promise<void> {
  const file = actionsFileForPath(path);
  const actions = readActions(path);
  const command = actions[action]?.command;
  if (!existsSync(file)) fail(`no actions.json found at ${file}`);
  if (!command) fail(`action not found or missing command: ${action}`);

  console.log(`${pc.cyan("◆")} ${pc.bold(action)} ${pc.dim(`in ${path}`)}`);
  console.log(`${pc.dim("$")} ${command}`);

  const shell = process.env.SHELL ?? "/bin/zsh";
  const proc = Bun.spawnSync([shell, "-lc", command], {
    cwd: path,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) fail(`action '${action}' failed with exit code ${proc.exitCode}`);
}

async function runInitIfPresent(path: string): Promise<void> {
  if (actionNames(path).includes("init")) {
    await runAction(path, "init");
  }
}

async function chooseWorktree(prompt: string, scopeCurrentProject = true): Promise<string> {
  let scope: string | undefined;
  if (scopeCurrentProject && isGitRepo()) scope = projectName();

  const paths = walkManagedWorktrees(scope);
  if (paths.length === 0) fail("no managed worktrees found");

  const selected = await select({
    message: prompt,
    options: paths.map((path) => ({
      value: path,
      label: scope ? worktreeName(path, scope) : relative(wtWorktreesDir, path),
      hint: worktreeBranch(path),
    })),
  });
  if (isCancel(selected)) {
    cancel("cancelled");
    process.exit(1);
  }
  return selected as string;
}

async function chooseAction(path: string): Promise<string> {
  const names = actionNames(path);
  if (names.length === 0) fail(`no actions found for ${path}`);

  const selected = await select({
    message: "Choose an action",
    options: names.map((name) => ({ value: name, label: name, hint: readActions(path)[name]?.command })),
  });
  if (isCancel(selected)) {
    cancel("cancelled");
    process.exit(1);
  }
  return selected as string;
}

function fetchRemotes(cwd = process.cwd()): void {
  const remotes = git(["remote"], cwd, { allowFail: true });
  if (!remotes.trim()) return;
  const s = spinner();
  s.start("Fetching remotes");
  const proc = Bun.spawnSync(["git", "fetch", "--prune", "--all"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode === 0) {
    s.stop("Fetched remotes");
    return;
  }
  s.stop("Fetch failed");
  const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr).trim() : "";
  fail(stderr || "git fetch failed");
}

async function cmdNew(args: string[]): Promise<void> {
  requireGitRepo();
  let base = "";
  let doFetch = true;
  let name = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--base") {
      base = args[++i] ?? fail("--base requires a value");
    } else if (arg.startsWith("--base=")) {
      base = arg.slice("--base=".length);
    } else if (arg === "--no-fetch") {
      doFetch = false;
    } else if (arg === "-h" || arg === "--help") {
      console.log(usage());
      return;
    } else if (arg.startsWith("-")) {
      fail(`unknown option for new: ${arg}`);
    } else if (!name) {
      name = arg;
    } else {
      fail("new accepts one NAME");
    }
  }

  if (!name) fail("new requires NAME");
  validateWorktreeName(name);

  if (doFetch) fetchRemotes();
  if (!base) base = defaultBaseRef();

  const project = projectName();
  const target = join(wtWorktreesDir, project, name);
  if (existsSync(target)) fail(`target already exists: ${target}`);

  mkdirSync(dirname(target), { recursive: true });
  const branchExists = Bun.spawnSync(["git", "show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0;

  intro(`wt new ${name}`);
  const gitArgs = branchExists ? ["worktree", "add", target, name] : ["worktree", "add", "-b", name, target, base];
  git(gitArgs, process.cwd(), { inherit: true });
  await runInitIfPresent(target);
  outro(`${pc.green("created")} ${target}`);
}

function cmdList(args: string[]): void {
  const all = args.includes("--all") || args.includes("-a");
  if (args.some((arg) => !["--all", "-a"].includes(arg))) fail(`unknown option for list: ${args.find((arg) => !["--all", "-a"].includes(arg))}`);

  const scope = !all && isGitRepo() ? projectName() : undefined;
  const paths = walkManagedWorktrees(scope);

  console.log(pc.bold("Worktrees"));
  if (paths.length === 0) {
    console.log(pc.dim("No managed worktrees found."));
    return;
  }

  for (const path of paths) {
    const rel = relative(wtWorktreesDir, path);
    const [project, ...nameParts] = rel.split("/");
    const name = nameParts.join("/");
    console.log(`${pc.cyan("◆")} ${pc.bold(project)} ${pc.green(name)} ${pc.dim(worktreeBranch(path))}`);
    console.log(`  ${pc.dim(path)}`);
  }
}

async function cmdOpen(args: string[]): Promise<void> {
  if (args.length > 1) fail("open accepts at most one NAME or PATH");
  const path = args[0] ? resolveWorktree(args[0]) : await chooseWorktree("Open which worktree?");

  const cursor = Bun.which("cursor");
  if (cursor) {
    runBin(cursor, [path], { inherit: true });
  } else if (existsSync("/Applications/Cursor.app")) {
    runBin("open", ["-a", "Cursor", path], { inherit: true });
  } else {
    fail("Cursor CLI not found and /Applications/Cursor.app does not exist");
  }

  console.log(`${pc.green("opened")} ${path}`);
}

async function cmdRun(args: string[]): Promise<void> {
  let path: string;
  let action: string;

  if (args.length === 0) {
    path = isGitRepo() ? repoRoot() : await chooseWorktree("Run action in which worktree?", false);
    action = await chooseAction(path);
  } else if (args.length === 1) {
    if (isGitRepo() && actionNames(repoRoot()).includes(args[0]!)) {
      path = repoRoot();
      action = args[0]!;
    } else {
      path = resolveWorktree(args[0]);
      action = await chooseAction(path);
    }
  } else if (args.length === 2) {
    path = resolveWorktree(args[0]);
    action = args[1]!;
  } else {
    fail("run requires ACTION or NAME ACTION");
  }

  await runAction(path, action);
}

async function cmdArchive(args: string[]): Promise<void> {
  let force = false;
  let target = "";
  for (const arg of args) {
    if (arg === "--force" || arg === "-f") force = true;
    else if (arg.startsWith("-")) fail(`unknown option for archive: ${arg}`);
    else if (!target) target = arg;
    else fail("archive accepts one NAME or PATH");
  }

  const path = target ? resolveWorktree(target) : await chooseWorktree("Archive which worktree?");
  if (!force) {
    const ok = await confirm({ message: `Archive ${worktreeName(path, projectName(path))}?`, initialValue: false });
    if (isCancel(ok) || !ok) {
      cancel("cancelled");
      process.exit(1);
    }
  }

  const argsForGit = force ? ["worktree", "remove", "--force", path] : ["worktree", "remove", path];
  git(argsForGit, path, { inherit: true });
  console.log(`${pc.green("archived")} ${path}`);
}

function completeWorktrees(): void {
  const scope = isGitRepo() ? projectName() : undefined;
  for (const path of walkManagedWorktrees(scope)) {
    console.log(scope ? worktreeName(path, scope) : relative(wtWorktreesDir, path));
  }
}

function completeRefs(): void {
  const refs = git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"], process.cwd(), {
    allowFail: true,
  });
  for (const ref of refs.split("\n").filter((line) => line && !line.endsWith("/HEAD"))) {
    console.log(ref);
  }
}

function completeActions(target?: string): void {
  let path: string | undefined;
  try {
    if (target) path = resolveWorktree(target);
    else if (isGitRepo()) path = repoRoot();
  } catch {
    return;
  }
  if (!path) return;
  for (const name of actionNames(path)) console.log(name);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    console.log(usage());
    return;
  }

  switch (cmd) {
    case "new":
      await cmdNew(args);
      break;
    case "list":
    case "ls":
      cmdList(args);
      break;
    case "open":
      await cmdOpen(args);
      break;
    case "run":
      await cmdRun(args);
      break;
    case "archive":
    case "rm":
    case "remove":
    case "delete":
      await cmdArchive(args);
      break;
    case "__complete-worktrees":
      completeWorktrees();
      break;
    case "__complete-refs":
      completeRefs();
      break;
    case "__complete-actions":
      completeActions(args[0]);
      break;
    case "-h":
    case "--help":
    case "help":
      console.log(usage());
      break;
    default:
      fail(`unknown command: ${cmd}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof WtError) {
    console.error(`${pc.red("wt:")} ${error.message}`);
    process.exit(1);
  }
  throw error;
});
