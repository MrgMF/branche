// Types partagés par les dictionnaires (paramètres des phrases composées).

/** Contexte d'une méthode de paiement (lib/methods.ts) : textes composés par chaque langue. */
export interface MethodCtx {
  /** Nom de l'opérateur (ou « l'opérateur »). */
  op: string;
  /** 4 derniers caractères du point choisi, s'il est connu. */
  short: string | null;
  /** Prises de la borne (« CCS Combo ou Type 2 »), vide si inconnues. */
  plugs: string;
  /** Câble attaché à la borne (DC ou déclaré), sinon câble Type 2 du conducteur. */
  stationCable: boolean;
  /** Courant continu : brancher d'abord. */
  dc: boolean;
  contactless: boolean;
}

export interface MethodTexts {
  label: string;
  why: string;
  steps: [string, string, string];
  cta: string;
}

/** Consigne de manœuvre générée (langues autres que le français ; le français garde le texte du fournisseur). */
export interface InstrParts {
  street?: string;
  towards?: string;
  exit?: number;
  exitNumber?: string;
}
