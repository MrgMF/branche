// Moyens de paiement acceptés (operator-portals.json `payMethods`) : seulement les valeurs `true` sourcées, avec de
// petits pictogrammes génériques (aucun logo : Apple Pay, Google Pay, PayPal en texte). « probable » formulé comme tel.
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { acceptedOn, walletOnPage, type AcceptedId, type Portal } from '../lib/portals';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';
import { Icon, type ShellIcon } from './Icon';

const ICON: Record<AcceptedId, ShellIcon> = { card: 'card', contactless: 'contactless', applePay: 'phone', googlePay: 'phone', paypal: 'wallet', other: 'wallet' };

/**
 * `card` : carte d'une méthode (« Accepté : … ») ; `sheet` : fiche station (canal précisé). `wallet` : rappel du
 * portefeuille confirmé sur la page de paiement selon l'appareil (iOS : Apple Pay, Android : Google Pay, web : les deux).
 */
export function AcceptedMethods({ portal, channel, variant = 'card', wallet = false }: { portal: Portal | undefined; channel: 'web' | 'reader'; variant?: 'card' | 'sheet'; wallet?: boolean }) {
  const t = useT();
  const A = t.accepted;
  const { fontScale } = useWindowDimensions();
  const acc = acceptedOn(portal, channel);
  if (!acc) return null;
  const iconSize = Math.round(15 * Math.min(2, Math.max(1, fontScale)));
  const prefix = variant === 'card' ? A.title : channel === 'web' ? A.web : A.reader;
  const names = acc.items.map((i) => i.brand ?? (i.id === 'card' ? A.card : A.contactless));
  const wallets = wallet && channel === 'web' ? walletOnPage(portal, Platform.OS) : [];
  return (
    <View style={styles.wrap} testID={`accepted-${channel}`}>
      {acc.items.length ? (
        <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel={`${prefix} ${names.join(', ')}`}>
          <Text style={styles.prefix}>{prefix}</Text>
          {acc.items.map((it, i) => (
            <View key={`${it.id}-${names[i]}`} style={styles.item}>
              <Icon name={ICON[it.id]} size={iconSize} color={colors.inkMuted} />
              <Text style={styles.name}>
                {names[i]}
                {i < names.length - 1 ? <Text style={styles.sep}>{' · '}</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {acc.nfcProbable ? (
        <View style={styles.row} testID="accepted-nfc-probable">
          <Icon name="contactless" size={iconSize} color={colors.inkMuted} />
          <Text style={[styles.prefix, styles.flex]}>{variant === 'sheet' || !acc.items.length ? (variant === 'sheet' ? A.nfcProbableReader : A.nfcProbable) : A.nfcProbable}</Text>
        </View>
      ) : null}
      {wallets.length ? (
        <View style={styles.row} testID="accepted-wallet">
          <Icon name="phone" size={iconSize} color={colors.accentPressed} />
          <Text style={[styles.wallet, styles.flex]}>{A.walletOnPage(wallets.length, wallets.join(A.and))}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  prefix: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
  name: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.ink },
  sep: { fontFamily: fonts.medium, color: colors.inkMuted },
  wallet: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.accentPressed },
  flex: { flexShrink: 1 },
});
