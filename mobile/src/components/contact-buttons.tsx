import { Linking, StyleSheet, View } from "react-native";
import { Button } from "@/components/ui";

export function ContactButtons({ email, phone, tel }: { email: string; phone: string; tel: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.slot}>
        <Button label="Contact us" variant="secondary" onPress={() => void Linking.openURL(`mailto:${email}`)} />
      </View>
      <View style={styles.slot}>
        <Button label="Call us" onPress={() => void Linking.openURL(tel)} />
      </View>
    </View>
  );
}

export const defaultContact = {
  contactEmail: "hello@farehamswimschool.com",
  contactPhone: "01329 802208",
  contactTel: "tel:+441329802208",
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  slot: { flex: 1 },
});
