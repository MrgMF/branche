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

/** Lecteur de carte : déclaré pour la borne (IRVE), signalé par l'opérateur « sur certains sites » (recherche), ou aucun. */
export interface ReaderInfo {
  source: 'irve' | 'operator' | null;
  /** Domaines des sources de la recherche (« tesla.com, tesla-mag.com »), cités dans le motif. */
  refs: string | null;
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

/** Saisie du point sur la page de paiement de l'opérateur (operator-portals.json `idEntry`, `idDigits`). */
export interface IdEntryInfo {
  /** emi3 : identifiant IRVE copié par Branché ; printed : numéro inscrit sur la borne ; select : choix dans une liste. */
  entry: 'emi3' | 'printed' | 'select' | null;
  /** Nombre de chiffres du numéro inscrit (Virta : 4 à 5), si publié. */
  digits: [number, number] | null;
}
