import {
  BodyBuild,
  CharacterArtStyle,
  CharacterConstraints,
  CharacterPalette,
  CharacterSpecification,
  DEFAULT_CUSTOM_OPTIMIZATION,
  DEFAULT_QUALITY_CONFIG,
  HairStyle,
  OutfitStyle,
  QualityConfig,
  VrmAllowance,
  VrmAllowedUser,
  VrmExportVersion,
  VrmMetadataConfig,
  VrmSourceLicenseRestrictions,
} from './types';

const ALLOWED_USER_RANK: Record<VrmAllowedUser, number> = {
  OnlyAuthor: 0,
  ExplicitlyLicensedPerson: 1,
  Everyone: 2,
};

const MODIFICATION_RANK: Record<VrmMetadataConfig['modification'], number> = {
  prohibited: 0,
  allowModification: 1,
  allowModificationRedistribution: 2,
};

const LICENSE_RESTRICTIVENESS: Record<string, number> = {
  Redistribution_Prohibited: 0,
  Other: 1,
  CC_BY_NC_ND: 2,
  CC_BY_ND: 3,
  CC_BY_NC_SA: 4,
  CC_BY_NC: 5,
  CC_BY_SA: 6,
  CC_BY: 7,
  CC0: 8,
};

export function checkSourceLicenseViolations(
  attempted: Partial<VrmMetadataConfig>,
  restrictions?: VrmSourceLicenseRestrictions
): string[] {
  if (!restrictions) return [];
  const violations: string[] = [];

  if (
    restrictions.allowedUserName &&
    attempted.allowedUserName &&
    ALLOWED_USER_RANK[attempted.allowedUserName] > ALLOWED_USER_RANK[restrictions.allowedUserName]
  ) {
    violations.push(
      `Source VRM license restricts allowedUserName to "${restrictions.allowedUserName}" (cannot relax to "${attempted.allowedUserName}").`
    );
  }
  if (restrictions.commercialUsage === 'Disallow' && attempted.commercialUsage === 'Allow') {
    violations.push('Source VRM license prohibits commercial usage (commercialUsage="Disallow").');
  }
  if (restrictions.violentUsage === 'Disallow' && attempted.violentUsage === 'Allow') {
    violations.push('Source VRM license prohibits violent usage (violentUsage="Disallow").');
  }
  if (restrictions.sexualUsage === 'Disallow' && attempted.sexualUsage === 'Allow') {
    violations.push('Source VRM license prohibits sexual usage (sexualUsage="Disallow").');
  }
  if (restrictions.allowRedistribution === false && attempted.allowRedistribution === true) {
    violations.push('Source VRM license prohibits redistribution (allowRedistribution=false).');
  }
  if (
    restrictions.modification &&
    attempted.modification &&
    MODIFICATION_RANK[attempted.modification] > MODIFICATION_RANK[restrictions.modification]
  ) {
    violations.push(
      `Source VRM license restricts modification to "${restrictions.modification}" (cannot relax to "${attempted.modification}").`
    );
  }
  if (restrictions.licenseName && attempted.licenseName) {
    const srcRank = LICENSE_RESTRICTIVENESS[restrictions.licenseName] ?? 1;
    const newRank = LICENSE_RESTRICTIVENESS[attempted.licenseName] ?? 1;
    if (
      (restrictions.licenseName === 'Redistribution_Prohibited' &&
        attempted.licenseName !== 'Redistribution_Prohibited') ||
      (srcRank < newRank && newRank >= 2)
    ) {
      violations.push(
        `Source VRM license "${restrictions.licenseName}" cannot be weakened to "${attempted.licenseName}".`
      );
    }
  }
  return violations;
}

export function clampMetadataToSourceRestrictions(
  meta: VrmMetadataConfig,
  restrictions?: VrmSourceLicenseRestrictions
): VrmMetadataConfig {
  const effectiveRestrictions = restrictions ?? meta.sourceRestrictions;
  if (!effectiveRestrictions) return meta;
  const clamped: VrmMetadataConfig = {
    ...meta,
    sourceRestrictions: effectiveRestrictions,
  };

  if (
    effectiveRestrictions.allowedUserName &&
    ALLOWED_USER_RANK[clamped.allowedUserName] >
      ALLOWED_USER_RANK[effectiveRestrictions.allowedUserName]
  ) {
    clamped.allowedUserName = effectiveRestrictions.allowedUserName;
  }
  if (effectiveRestrictions.commercialUsage === 'Disallow') {
    clamped.commercialUsage = 'Disallow';
  }
  if (effectiveRestrictions.violentUsage === 'Disallow') {
    clamped.violentUsage = 'Disallow';
  }
  if (effectiveRestrictions.sexualUsage === 'Disallow') {
    clamped.sexualUsage = 'Disallow';
  }
  if (effectiveRestrictions.allowRedistribution === false) {
    clamped.allowRedistribution = false;
  }
  if (
    effectiveRestrictions.modification &&
    MODIFICATION_RANK[clamped.modification] >
      MODIFICATION_RANK[effectiveRestrictions.modification]
  ) {
    clamped.modification = effectiveRestrictions.modification;
  }
  if (effectiveRestrictions.licenseName) {
    const srcRank = LICENSE_RESTRICTIVENESS[effectiveRestrictions.licenseName] ?? 1;
    const curRank = LICENSE_RESTRICTIVENESS[clamped.licenseName] ?? 1;
    if (
      (effectiveRestrictions.licenseName === 'Redistribution_Prohibited' &&
        clamped.licenseName !== 'Redistribution_Prohibited') ||
      (srcRank < curRank && curRank >= 2)
    ) {
      clamped.licenseName = effectiveRestrictions.licenseName;
    }
  }
  return clamped;
}

export function createDefaultVrmMetadata(
  title: string,
  overrides?: Partial<VrmMetadataConfig>
): VrmMetadataConfig {
  const base: VrmMetadataConfig = {
    title: (overrides?.title ?? title).trim() || 'Generated Avatar',
    author: (overrides?.author ?? '').trim(),
    version: (overrides?.version ?? '1.0').trim() || '1.0',
    contactInformation: (overrides?.contactInformation ?? '').trim(),
    reference: (overrides?.reference ?? '').trim(),
    licenseName: (overrides?.licenseName ?? 'Other').trim() || 'Other',
    otherLicenseUrl: (overrides?.otherLicenseUrl ?? '').trim(),
    otherPermissionUrl: (overrides?.otherPermissionUrl ?? '').trim() || undefined,
    allowedUserName: overrides?.allowedUserName ?? 'OnlyAuthor',
    violentUsage: overrides?.violentUsage ?? 'Disallow',
    sexualUsage: overrides?.sexualUsage ?? 'Disallow',
    commercialUsage: overrides?.commercialUsage ?? 'Disallow',
    allowRedistribution: overrides?.allowRedistribution ?? false,
    modification: overrides?.modification ?? 'prohibited',
    sourceAttribution: overrides?.sourceAttribution?.trim() || undefined,
    sourceRestrictions: overrides?.sourceRestrictions,
  };
  return clampMetadataToSourceRestrictions(base, overrides?.sourceRestrictions);
}

function matchFirstColor(text: string, patterns: Array<[RegExp, string]>): string | null {
  for (const [regex, hex] of patterns) {
    if (regex.test(text)) {
      return hex;
    }
  }
  return null;
}

export function normalizeHexColor(hex: string | undefined, fallback: string): string {
  if (!hex) return fallback;
  const cleaned = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) {
    return cleaned.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  return fallback;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function parseCharacterPromptFallback(
  prompt: string,
  options?: {
    id?: string;
    name?: string;
    interpreterProvider?: string;
    geometryProvider?: string;
    artStyle?: CharacterArtStyle;
    vrmVersion?: VrmExportVersion;
    vrmMetadata?: Partial<VrmMetadataConfig>;
    qualityConfig?: Partial<QualityConfig>;
  }
): CharacterSpecification {
  const lower = prompt.toLowerCase();

  let species = 'Human';
  if (/dark\s*elf|drow/.test(lower)) species = 'Dark Elf';
  else if (/high\s*elf|wood\s*elf|\belf\b|elven/.test(lower)) species = 'Elf';
  else if (/demon|tiefling|succubus|oni/.test(lower)) species = 'Tiefling / Demon';
  else if (/android|cyborg|robot|mecha/.test(lower)) species = 'Cybernetic Android';
  else if (/angel|seraph|valkyrie/.test(lower)) species = 'Celestial';
  else if (/cat|neko|kitsune|fox|wolf/.test(lower)) species = 'Beastkin';

  let genderPresentation: CharacterSpecification['genderPresentation'] = 'androgynous';
  if (/\b(female|woman|girl|she|her|princess|queen|maiden|sorceress)\b/.test(lower)) {
    genderPresentation = 'feminine';
  } else if (/\b(male|man|boy|he|him|knight|king|prince|warrior)\b/.test(lower)) {
    genderPresentation = 'masculine';
  }

  let build: BodyBuild = 'average';
  if (/athletic|agile|toned|fit|acrobatic/.test(lower)) build = 'athletic';
  else if (/slender|slim|lean|lithe|thin|graceful/.test(lower)) build = 'slender';
  else if (/muscular|buff|brawny|heroic|broad/.test(lower)) build = 'muscular';
  else if (/heavy|stocky|stout|armored\s*juggernaut/.test(lower)) build = 'heavy';

  let heightMeters = 1.72;
  if (/\btall\b|towering|lofty/.test(lower)) heightMeters = 1.82;
  else if (/\bshort\b|petite|compact/.test(lower)) heightMeters = 1.58;
  else if (genderPresentation === 'feminine') heightMeters = 1.68;
  else if (genderPresentation === 'masculine') heightMeters = 1.78;

  let hairStyle: HairStyle = 'long_flowing';
  if (/ponytail/.test(lower)) hairStyle = 'ponytail';
  else if (/\bbob\b|shoulder[-\s]length/.test(lower)) hairStyle = 'bob';
  else if (/short|cropped|buzz|pixie/.test(lower)) hairStyle = 'short_crop';
  else if (/braid|braided/.test(lower)) hairStyle = 'braided';
  else if (/spiky|wild|punk/.test(lower)) hairStyle = 'spiky';

  let outfitStyle: OutfitStyle = 'ornate_armor_cloak';
  if (/armor|plate|knight|paladin|gauntlet|pauldron/.test(lower)) outfitStyle = 'ornate_armor_cloak';
  else if (/cyber|sci-fi|tech|neon|tactical|visor/.test(lower)) outfitStyle = 'cyber_tactical';
  else if (/robe|mage|wizard|sorcerer|witch|mystic/.test(lower)) outfitStyle = 'fantasy_robe';
  else if (/royal|noble|gown|coat|imperial/.test(lower)) outfitStyle = 'royal_regalia';
  else if (/casual|jacket|hoodie|jeans|modern|street/.test(lower)) outfitStyle = 'casual_modern';

  const skinColor =
    matchFirstColor(lower, [
      [/pale\s*lavender|lavender\s*skin/, '#cbb8e6'],
      [/purple\s*skin|violet\s*skin|dark\s*elf|drow/, '#9c8bb8'],
      [/obsidian|ebony|charcoal\s*skin/, '#3e3a47'],
      [/pale|ivory|porcelain|fair/, '#f3dfd4'],
      [/tan|olive|bronze|sun-kissed/, '#c9936b'],
      [/dark\s*brown|deep\s*brown|rich\s*brown/, '#6e4532'],
      [/emerald|green\s*skin|orc/, '#6a9668'],
      [/azure|blue\s*skin|frost/, '#8ab4d8'],
    ]) ?? (species === 'Dark Elf' ? '#cbb8e6' : '#e6c4b0');

  const hairColor =
    matchFirstColor(lower, [
      [/silver\s*hair|platinum\s*hair|white\s*hair/, '#dfe5f2'],
      [/violet\s*hair|purple\s*hair/, '#8d64d4'],
      [/crimson\s*hair|red\s*hair|scarlet/, '#b63b42'],
      [/black\s*hair|raven|obsidian\s*hair|dark\s*hair/, '#1d2028'],
      [/blonde|golden\s*hair/, '#e2c06b'],
      [/blue\s*hair|cobalt|sapphire\s*hair/, '#3b74c7'],
      [/emerald\s*hair|green\s*hair/, '#388e6c'],
      [/pink\s*hair|rose\s*hair/, '#e38ab8'],
      [/auburn|chestnut|brown\s*hair/, '#6a4132'],
    ]) ?? '#dfe5f2';

  const eyeColor =
    matchFirstColor(lower, [
      [/violet\s*eyes|purple\s*eyes|amethyst/, '#a855f7'],
      [/crimson\s*eyes|red\s*eyes|ruby/, '#ef4444'],
      [/gold\s*eyes|amber\s*eyes|golden\s*eyes/, '#f59e0b'],
      [/emerald\s*eyes|green\s*eyes/, '#10b981'],
      [/ice\s*blue|cyan\s*eyes|blue\s*eyes|azure/, '#38bdf8'],
    ]) ?? '#a855f7';

  // Strip eye/hair/skin color phrases so "emerald eyes", "golden hair", or "layered" never pollute outfit/cloak colors
  const outfitText = lower
    .replace(/\b[\w-]+\s+(?:and\s+[\w-]+\s+)?(?:eyes?|hair|skin|complexion)\b/g, ' ')
    .replace(/\b(?:pale|fair|tan|olive|lavender|porcelain|golden|silver|emerald|violet|crimson|amber|ivory)\s+(?:eyes?|hair|skin)\b/g, ' ');

  const primaryOutfitColor =
    matchFirstColor(outfitText, [
      [/\bblack[-\s]and[-\s]purple\b|\bobsidian\s*armor\b|\bblack\s*armor\b/, '#1c1b24'],
      [/\bcrimson\b|\bscarlet\b|\bred\s*armor\b/, '#7f1d1d'],
      [/\bdark\s*brown\b|\bbrown\b|\bleather\b/, '#4a3222'],
      [/\bivory\b|\bwhite\b|\bpaladin\b|\bsilver\s*armor\b/, '#d8dee9'],
      [/\bemerald\b|\bforest\b|\bgreen\b/, '#14532d'],
      [/\bnavy\b|\bcobalt\b|\bblue\b/, '#1e3a8a'],
    ]) ?? '#1e1d29';

  const secondaryOutfitColor =
    matchFirstColor(outfitText, [
      [/\bpurple\b|\bviolet\b|\bamethyst\b/, '#6d28d9'],
      [/\bsilver\b|\bsteel\b|\bivory\b/, '#94a3b8'],
      [/\bgold\b|\bgilded\b|\bbrass\b/, '#b45309'],
      [/\bdark\s*brown\b|\bbrown\b|\bleather\b/, '#2c1e16'],
      [/\bcyan\b|\bteal\b/, '#0e7490'],
      [/\bcrimson\b|\bred\b|\bscarlet\b/, '#991b1b'],
    ]) ?? (outfitStyle === 'cyber_tactical' ? '#334155' : '#6d28d9');

  const earStyle: CharacterSpecification['features']['earStyle'] =
    species === 'Dark Elf' || species === 'Elf' || /pointed\s*ears|elf\s*ears/.test(lower)
      ? 'long_elf'
      : 'human';

  // Negative/forbidden clauses always override positive feature triggers
  const forbidWings = /\b(?:no|without|zero|never|avoid)\s+(?:any\s+)?(?:wings?|winged|pinions)\b/.test(lower);
  const forbidHorns = /\b(?:no|without|zero|never|avoid)\s+(?:any\s+)?(?:horns?|horned|antlers?)\b/.test(lower);
  const forbidTail = /\b(?:no|without|zero|never|avoid)\s+(?:any\s+)?(?:tail|tailed)\b/.test(lower);
  const forbidCloak = /\b(?:no|without|zero|never|avoid)\s+(?:any\s+)?(?:cloak|cape|mantle|shroud)\b/.test(lower);
  const forbidArmor = /\b(?:no|without|zero|never|avoid)\s+(?:any\s+)?(?:armor|armour|plate|pauldrons?)\b|\bunarmored\b/.test(lower);

  // Strictly gate optional appendages & major gear on explicit prompt terms (never invent unrequested features)
  const hasCloak = !forbidCloak && /\b(cloak|cape|mantle|shroud)\b/.test(lower);
  const hasArmor =
    !forbidArmor &&
    /\b(armor|armored|armour|plate|plated|pauldron|breastplate|cuirass|knight|paladin|gauntlet|greaves)\b/.test(lower);
  const hasWings = !forbidWings && /\b(wings?|winged|pinions)\b/.test(lower);
  const hasTail = !forbidTail && /\b(tail|tailed)\b/.test(lower);
  const hasHorns = !forbidHorns && /\b(horns?|horned|antlers?)\b/.test(lower);

  const shoulderWidthScale =
    build === 'muscular'
      ? 1.14
      : build === 'slender'
        ? 0.92
        : genderPresentation === 'masculine'
          ? 1.07
          : 0.96;
  const hipWidthScale =
    genderPresentation === 'feminine'
      ? build === 'slender'
        ? 1.02
        : 1.08
      : 0.95;

  const derivedName =
    options?.name ||
    (species === 'Dark Elf'
      ? 'Vaelith Nightshade'
      : species === 'Cybernetic Android'
        ? 'Unit-09 Seraph'
        : species === 'Celestial'
          ? 'Aurelia Dawn'
          : `${species} Avatar`);

  let artStyle: CharacterArtStyle = options?.artStyle ?? 'semi_realistic';
  if (!options?.artStyle) {
    if (/\b(anime|cel|manga|stylized\s*anime|vtuber)\b/.test(lower)) artStyle = 'stylized_anime';
    else if (/\b(realistic\s*human|photoreal|lifelike|anatomically\s*realistic|hyperrealistic)\b/.test(lower)) {
      artStyle = 'realistic_human';
    }
  }

  const now = new Date().toISOString();
  const qCfg: QualityConfig = {
    geometryQuality: options?.qualityConfig?.geometryQuality ?? DEFAULT_QUALITY_CONFIG.geometryQuality,
    textureResolution: options?.qualityConfig?.textureResolution ?? DEFAULT_QUALITY_CONFIG.textureResolution,
    vrmOptimization: options?.qualityConfig?.vrmOptimization ?? DEFAULT_QUALITY_CONFIG.vrmOptimization,
    customOptimization: {
      ...DEFAULT_CUSTOM_OPTIMIZATION,
      ...(options?.qualityConfig?.customOptimization || {}),
    },
  };

  const cloakColor =
    matchFirstColor(outfitText, [
      [/\bpurple\b|\bviolet\b|\bamethyst\b|\bblack-and-purple\b/, '#2e1b4b'],
      [/\broyal\b|\bcelestial\b|\bsapphire\b|\bnavy\b|\bblue\b/, '#1e3a8a'],
      [/\bcrimson\b|\bred\b|\bscarlet\b/, '#450a0a'],
      [/\bemerald\b|\bgreen\b/, '#064e3b'],
      [/\bwhite\b|\bivory\b|\bsilver\b/, '#cbd5e1'],
    ]) ?? '#1e1b2e';

  const requiredFeatures: string[] = [];
  const optionalFeatures: string[] = [];
  const forbiddenFeatures: string[] = [];
  const requiredPalette: Partial<Record<keyof CharacterPalette, string>> = {};

  if (hasArmor) requiredFeatures.push('armor');
  else if (forbidArmor) forbiddenFeatures.push('armor');
  else optionalFeatures.push('armor');

  if (hasCloak) requiredFeatures.push('cloak');
  else if (forbidCloak) forbiddenFeatures.push('cloak');
  else optionalFeatures.push('cloak');

  if (hasWings) requiredFeatures.push('wings');
  else forbiddenFeatures.push('wings');

  if (hasHorns) requiredFeatures.push('horns');
  else forbiddenFeatures.push('horns');

  if (hasTail) requiredFeatures.push('tail');
  else forbiddenFeatures.push('tail');

  if (earStyle !== 'human') requiredFeatures.push(`earStyle:${earStyle}`);
  if (/skin|lavender|pale|ivory|porcelain|fair|tan|olive|obsidian|dark\s*elf|drow/.test(lower)) {
    requiredPalette.skinColor = skinColor;
  }
  if (/hair|silver|platinum|blonde|golden|raven|crimson|pink|brown/.test(lower)) {
    requiredPalette.hairColor = hairColor;
  }
  if (/eyes?|violet|purple|emerald|amber|crimson|blue/.test(lower)) {
    requiredPalette.eyeColor = eyeColor;
  }
  if (
    /black[-\s]and[-\s]purple|obsidian|dark\s*brown|silver[-\s]and[-\s]ivory|navy[-\s]and[-\s]gold|royal\s*cloak/.test(
      lower
    )
  ) {
    requiredPalette.primaryOutfitColor = primaryOutfitColor;
    requiredPalette.secondaryOutfitColor = secondaryOutfitColor;
    if (hasCloak) requiredPalette.cloakColor = cloakColor;
  }

  const constraints: CharacterConstraints = {
    requiredFeatures,
    optionalFeatures,
    forbiddenFeatures,
    requiredPalette,
  };

  return {
    id: options?.id || `char_${Date.now().toString(36)}`,
    name: derivedName,
    version: 1,
    sourcePrompt: prompt.trim(),
    species,
    genderPresentation,
    ageAppearance: 'young_adult',
    build,
    artStyle,
    aesthetic: /mysterious/.test(lower)
      ? 'Mysterious Dark Fantasy'
      : outfitStyle === 'cyber_tactical'
        ? 'High-Precision Sci-Fi'
        : artStyle === 'stylized_anime'
          ? 'Stylized Anime Character'
          : 'Semi-Realistic Character',
    hairStyle,
    outfitStyle,
    proportions: {
      heightMeters,
      shoulderWidthScale,
      hipWidthScale,
      limbLengthScale: build === 'slender' || heightMeters > 1.76 ? 1.04 : 1.0,
      headScale: 1.0,
    },
    palette: {
      skinColor,
      hairColor,
      eyeColor,
      eyeEmissive: /glow|luminous|radiant|bright|neon/.test(lower) || outfitStyle === 'cyber_tactical',
      primaryOutfitColor,
      secondaryOutfitColor,
      accentMetallicColor: /\b(gold|gilded|brass|bronze)\b/.test(outfitText)
        ? '#d4af37'
        : /\b(silver|ivory|steel|chrome)\b/.test(outfitText)
          ? '#cbd5e1'
          : /\b(leather|tactical|ranger)\b/.test(outfitText)
            ? '#6b5344'
            : '#6f7a8f',
      cloakColor,
    },
    features: {
      earStyle,
      hasCloak,
      hasArmor,
      hasWings,
      hasTail,
      hasHorns,
    },
    constraints,
    qualityConfig: qCfg,
    riggingRequirements: {
      vrmVersion: options?.vrmVersion ?? '0.0',
      includeFingerBones: true,
      includeFaceRig: true,
      includeSpringBones: hasCloak || hairStyle === 'long_flowing' || hairStyle === 'ponytail',
      targetPolygonBudget:
        qCfg.geometryQuality === 'ultra'
          ? 65000
          : qCfg.geometryQuality === 'high'
            ? 38000
            : qCfg.geometryQuality === 'standard'
              ? 22000
              : 12000,
    },
    vrmMetadata: createDefaultVrmMetadata(derivedName, options?.vrmMetadata),
    interpreterProvider: options?.interpreterProvider || 'local-semantic-parser',
    geometryProvider: options?.geometryProvider || 'sculpted-anatomical-vrm',
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeCharacterSpec(
  raw: Partial<CharacterSpecification>,
  sourcePrompt: string,
  allowExplicitOverride = false
): CharacterSpecification {
  const base = parseCharacterPromptFallback(sourcePrompt);
  const lower = sourcePrompt.toLowerCase();
  const rawQ = raw.qualityConfig;
  const qualityConfig: QualityConfig = {
    geometryQuality: rawQ?.geometryQuality ?? base.qualityConfig.geometryQuality,
    textureResolution: rawQ?.textureResolution ?? base.qualityConfig.textureResolution,
    vrmOptimization: rawQ?.vrmOptimization ?? base.qualityConfig.vrmOptimization,
    customOptimization: {
      ...DEFAULT_CUSTOM_OPTIMIZATION,
      ...(rawQ?.customOptimization || {}),
    },
  };

  // Preserve explicitly requested prompt palette colors when not explicitly overridden in UI
  const lockSkin = !allowExplicitOverride && Boolean(base.constraints?.requiredPalette.skinColor);
  const lockHair = !allowExplicitOverride && Boolean(base.constraints?.requiredPalette.hairColor);
  const lockEyes = !allowExplicitOverride && Boolean(base.constraints?.requiredPalette.eyeColor);
  const lockArmorColors =
    !allowExplicitOverride && Boolean(base.constraints?.requiredPalette.primaryOutfitColor);

  const features = allowExplicitOverride
    ? {
        ...base.features,
        ...(raw.features || {}),
      }
    : {
        earStyle:
          base.features.earStyle !== 'human'
            ? base.features.earStyle
            : (raw.features?.earStyle ?? base.features.earStyle),
        hasCloak: base.features.hasCloak,
        hasArmor: base.features.hasArmor,
        hasWings: base.features.hasWings,
        hasTail: base.features.hasTail,
        hasHorns: base.features.hasHorns,
      };

  const baseConstraints = base.constraints ?? {
    requiredFeatures: [],
    optionalFeatures: [],
    forbiddenFeatures: [],
    requiredPalette: {},
  };

  let constraints: CharacterConstraints = baseConstraints;
  if (allowExplicitOverride) {
    // Reflect explicit Customize UI changes into constraints while retaining un-edited prohibitions
    const forbidden = new Set(baseConstraints.forbiddenFeatures);
    const required = new Set(baseConstraints.requiredFeatures);
    if (features.hasWings) {
      forbidden.delete('wings');
      required.add('wings');
    } else {
      required.delete('wings');
      forbidden.add('wings');
    }
    if (features.hasHorns) {
      forbidden.delete('horns');
      required.add('horns');
    } else {
      required.delete('horns');
      forbidden.add('horns');
    }
    if (features.hasTail) {
      forbidden.delete('tail');
      required.add('tail');
    } else {
      required.delete('tail');
      forbidden.add('tail');
    }
    if (features.hasCloak) {
      forbidden.delete('cloak');
    } else {
      required.delete('cloak');
    }
    if (features.hasArmor) {
      forbidden.delete('armor');
    } else {
      required.delete('armor');
    }
    for (const r of Array.from(required)) {
      if (r.startsWith('earStyle:') && r !== `earStyle:${features.earStyle}`) {
        required.delete(r);
      }
    }
    if (features.earStyle !== 'human') {
      required.add(`earStyle:${features.earStyle}`);
    }

    const reqPalette = { ...baseConstraints.requiredPalette };
    if (raw.palette?.skinColor) reqPalette.skinColor = normalizeHexColor(raw.palette.skinColor, base.palette.skinColor);
    if (raw.palette?.hairColor) reqPalette.hairColor = normalizeHexColor(raw.palette.hairColor, base.palette.hairColor);
    if (raw.palette?.eyeColor) reqPalette.eyeColor = normalizeHexColor(raw.palette.eyeColor, base.palette.eyeColor);
    if (raw.palette?.primaryOutfitColor) {
      reqPalette.primaryOutfitColor = normalizeHexColor(raw.palette.primaryOutfitColor, base.palette.primaryOutfitColor);
    }
    if (raw.palette?.secondaryOutfitColor) {
      reqPalette.secondaryOutfitColor = normalizeHexColor(
        raw.palette.secondaryOutfitColor,
        base.palette.secondaryOutfitColor
      );
    }
    if (raw.palette?.accentMetallicColor) {
      reqPalette.accentMetallicColor = normalizeHexColor(
        raw.palette.accentMetallicColor,
        base.palette.accentMetallicColor
      );
    }
    if (raw.palette?.cloakColor) reqPalette.cloakColor = normalizeHexColor(raw.palette.cloakColor, base.palette.cloakColor);

    constraints = {
      requiredFeatures: Array.from(required),
      optionalFeatures: baseConstraints.optionalFeatures,
      forbiddenFeatures: Array.from(forbidden),
      requiredPalette: reqPalette,
    };
  }

  return {
    ...base,
    ...raw,
    id: raw.id || base.id,
    name: raw.name?.trim() || base.name,
    version: raw.version && raw.version >= 1 ? raw.version : 1,
    sourcePrompt: sourcePrompt.trim() || base.sourcePrompt,
    species: !allowExplicitOverride && base.species !== 'Human' ? base.species : (raw.species ?? base.species),
    artStyle: raw.artStyle ?? base.artStyle,
    proportions: {
      heightMeters: clampNumber(raw.proportions?.heightMeters ?? base.proportions.heightMeters, 1.35, 2.2),
      shoulderWidthScale: clampNumber(raw.proportions?.shoulderWidthScale ?? base.proportions.shoulderWidthScale, 0.78, 1.35),
      hipWidthScale: clampNumber(raw.proportions?.hipWidthScale ?? base.proportions.hipWidthScale, 0.78, 1.35),
      limbLengthScale: clampNumber(raw.proportions?.limbLengthScale ?? base.proportions.limbLengthScale, 0.85, 1.2),
      headScale: clampNumber(raw.proportions?.headScale ?? base.proportions.headScale, 0.82, 1.25),
    },
    palette: {
      skinColor: lockSkin ? base.palette.skinColor : normalizeHexColor(raw.palette?.skinColor, base.palette.skinColor),
      hairColor: lockHair ? base.palette.hairColor : normalizeHexColor(raw.palette?.hairColor, base.palette.hairColor),
      eyeColor: lockEyes ? base.palette.eyeColor : normalizeHexColor(raw.palette?.eyeColor, base.palette.eyeColor),
      eyeEmissive: raw.palette?.eyeEmissive ?? base.palette.eyeEmissive,
      primaryOutfitColor: lockArmorColors ? base.palette.primaryOutfitColor : normalizeHexColor(raw.palette?.primaryOutfitColor, base.palette.primaryOutfitColor),
      secondaryOutfitColor: lockArmorColors ? base.palette.secondaryOutfitColor : normalizeHexColor(raw.palette?.secondaryOutfitColor, base.palette.secondaryOutfitColor),
      accentMetallicColor: lockArmorColors ? base.palette.accentMetallicColor : normalizeHexColor(raw.palette?.accentMetallicColor, base.palette.accentMetallicColor),
      cloakColor: lockArmorColors ? base.palette.cloakColor : normalizeHexColor(raw.palette?.cloakColor, base.palette.cloakColor),
    },
    features,
    constraints,
    qualityConfig,
    riggingRequirements: {
      ...base.riggingRequirements,
      ...(raw.riggingRequirements || {}),
      vrmVersion:
        raw.riggingRequirements?.vrmVersion === '1.0'
          ? '1.0'
          : '0.0',
    },
    vrmMetadata: createDefaultVrmMetadata(
      raw.name?.trim() || base.name,
      raw.vrmMetadata ?? base.vrmMetadata
    ),
    updatedAt: new Date().toISOString(),
  };
}

export interface SpecificationValidationResult {
  valid: boolean;
  violations: string[];
  checkedConstraints: number;
}

export function validateCharacterSpecification(
  spec: CharacterSpecification
): SpecificationValidationResult {
  const violations: string[] = [];
  let checkedConstraints = 0;

  // 1. Validate hex palette fields
  const hexRegex = /^#[0-9a-fA-F]{6}$/;
  const paletteEntries = Object.entries(spec.palette) as Array<[keyof CharacterPalette, unknown]>;
  for (const [key, val] of paletteEntries) {
    if (key === 'eyeEmissive') continue;
    checkedConstraints++;
    if (typeof val !== 'string' || !hexRegex.test(val)) {
      violations.push(`Palette color "${key}" must be a 6-digit hex color (got "${String(val)}").`);
    }
  }

  // 2. Validate anatomical proportions
  checkedConstraints++;
  if (spec.proportions.heightMeters < 1.35 || spec.proportions.heightMeters > 2.2) {
    violations.push(`Height ${spec.proportions.heightMeters}m is outside valid humanoid bounds (1.35m - 2.20m).`);
  }

  const constraints = spec.constraints;
  if (constraints) {
    // 3. Enforce forbidden features
    for (const forbidden of constraints.forbiddenFeatures) {
      checkedConstraints++;
      if (forbidden === 'wings' && spec.features.hasWings) {
        violations.push('Forbidden feature "wings" was enabled despite not being requested or being explicitly excluded.');
      }
      if (forbidden === 'horns' && spec.features.hasHorns) {
        violations.push('Forbidden feature "horns" was enabled despite not being requested or being explicitly excluded.');
      }
      if (forbidden === 'tail' && spec.features.hasTail) {
        violations.push('Forbidden feature "tail" was enabled despite not being requested or being explicitly excluded.');
      }
      if (forbidden === 'cloak' && spec.features.hasCloak) {
        violations.push('Forbidden feature "cloak" was enabled despite explicit exclusion.');
      }
      if (forbidden === 'armor' && spec.features.hasArmor) {
        violations.push('Forbidden feature "armor" was enabled despite explicit exclusion.');
      }
    }

    // 4. Enforce required features
    for (const req of constraints.requiredFeatures) {
      checkedConstraints++;
      if (req === 'armor' && !spec.features.hasArmor) {
        violations.push('Required feature "armor" from prompt specification is missing.');
      }
      if (req === 'cloak' && !spec.features.hasCloak) {
        violations.push('Required feature "cloak" from prompt specification is missing.');
      }
      if (req === 'wings' && !spec.features.hasWings) {
        violations.push('Required feature "wings" from prompt specification is missing.');
      }
      if (req === 'horns' && !spec.features.hasHorns) {
        violations.push('Required feature "horns" from prompt specification is missing.');
      }
      if (req === 'tail' && !spec.features.hasTail) {
        violations.push('Required feature "tail" from prompt specification is missing.');
      }
      if (req.startsWith('earStyle:')) {
        const expectedEar = req.split(':')[1];
        if (spec.features.earStyle !== expectedEar) {
          violations.push(`Required earStyle "${expectedEar}" violated (got "${spec.features.earStyle}").`);
        }
      }
    }

    // 5. Enforce locked prompt palette fidelity
    for (const [k, expectedHex] of Object.entries(constraints.requiredPalette) as Array<
      [keyof CharacterPalette, string]
    >) {
      checkedConstraints++;
      const actual = spec.palette[k];
      if (typeof actual === 'string' && actual.toLowerCase() !== expectedHex.toLowerCase()) {
        violations.push(
          `Required palette color "${k}" drifted from "${expectedHex}" to "${actual}".`
        );
      }
    }
  }

  // 6. Enforce non-relaxation of source license restrictions if imported from restricted VRM
  if (spec.vrmMetadata?.sourceRestrictions) {
    checkedConstraints++;
    const licenseViolations = checkSourceLicenseViolations(
      spec.vrmMetadata,
      spec.vrmMetadata.sourceRestrictions
    );
    violations.push(...licenseViolations);
  }

  return {
    valid: violations.length === 0,
    violations,
    checkedConstraints,
  };
}

export function applyCharacterEdits(
  spec: CharacterSpecification,
  patch: {
    name?: string;
    build?: BodyBuild;
    artStyle?: CharacterArtStyle;
    hairStyle?: HairStyle;
    outfitStyle?: OutfitStyle;
    proportions?: Partial<CharacterSpecification['proportions']>;
    palette?: Partial<CharacterSpecification['palette']>;
    features?: Partial<CharacterSpecification['features']>;
    qualityConfig?: Partial<QualityConfig>;
    vrmVersion?: VrmExportVersion;
    vrmMetadata?: Partial<VrmMetadataConfig>;
  }
): CharacterSpecification {
  const sourceRestrictions = spec.vrmMetadata?.sourceRestrictions;
  const merged: CharacterSpecification = {
    ...spec,
    name: patch.name?.trim() || spec.name,
    version: spec.version + 1,
    build: patch.build ?? spec.build,
    artStyle: patch.artStyle ?? spec.artStyle,
    hairStyle: patch.hairStyle ?? spec.hairStyle,
    outfitStyle: patch.outfitStyle ?? spec.outfitStyle,
    proportions: {
      ...spec.proportions,
      ...(patch.proportions || {}),
    },
    palette: {
      ...spec.palette,
      ...(patch.palette || {}),
    },
    features: {
      ...spec.features,
      ...(patch.features || {}),
    },
    qualityConfig: {
      geometryQuality: patch.qualityConfig?.geometryQuality ?? spec.qualityConfig.geometryQuality,
      textureResolution: patch.qualityConfig?.textureResolution ?? spec.qualityConfig.textureResolution,
      vrmOptimization: patch.qualityConfig?.vrmOptimization ?? spec.qualityConfig.vrmOptimization,
      customOptimization: {
        ...spec.qualityConfig.customOptimization,
        ...(patch.qualityConfig?.customOptimization || {}),
      },
    },
    riggingRequirements: {
      ...spec.riggingRequirements,
      vrmVersion: patch.vrmVersion ?? spec.riggingRequirements.vrmVersion,
    },
    vrmMetadata: createDefaultVrmMetadata(
      patch.name?.trim() || spec.name,
      {
        ...(spec.vrmMetadata || {}),
        ...(patch.vrmMetadata || {}),
        ...(sourceRestrictions ? { sourceRestrictions } : {}),
      }
    ),
    updatedAt: new Date().toISOString(),
  };
  return normalizeCharacterSpec(merged, spec.sourcePrompt, true);
}
