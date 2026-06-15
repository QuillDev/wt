{
  lib,
  stdenv,
  bun,
  makeWrapper,
  writableTmpDirAsHomeHook,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "wt";
  version = "0.1.6";

  src = lib.fileset.toSource {
    root = ./..;
    fileset = lib.fileset.unions [
      ../bun.lock
      ../package.json
      ../src
      ../tsconfig.json
    ];
  };

  node_modules = stdenv.mkDerivation {
    pname = "${finalAttrs.pname}-node_modules";
    inherit (finalAttrs) version src;

    nativeBuildInputs = [
      bun
      writableTmpDirAsHomeHook
    ];

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild

      export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
      bun install \
        --frozen-lockfile \
        --ignore-scripts \
        --no-progress \
        --production

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out
      cp -R node_modules $out/

      runHook postInstall
    '';

    dontFixup = true;

    outputHash = "sha256-jRN0ZXjhtw6+X8iikjt+r617NIBqxJ4EWmRzlFLb76E=";
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
  };

  nativeBuildInputs = [
    bun
    makeWrapper
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/node_modules .

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild

    bun build --compile --outfile wt src/index.ts

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 wt $out/bin/wt
    wrapProgram $out/bin/wt \
      --prefix PATH : "${lib.makeBinPath [ bun ]}"

    runHook postInstall
  '';

  # strip removes the embedded JavaScript bundle from Bun-compiled binaries.
  dontStrip = true;

  meta = {
    description = "Small CLI for managing Git worktrees";
    homepage = "https://github.com/QuillDev/wt";
    mainProgram = "wt";
    platforms = lib.platforms.all;
  };
})
