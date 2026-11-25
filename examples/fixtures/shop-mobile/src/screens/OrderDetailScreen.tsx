// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { useNavigation, useRoute } from "@react-navigation/native";
import { Button, Text, View } from "react-native";

export function OrderDetailScreen() {
  const navigation = useNavigation();
  const { params } = useRoute();
  return (
    <View>
      <Text>Order {String((params as { orderId?: string })?.orderId)}</Text>
      <Button title="Back to catalog" onPress={() => navigation.navigate("Catalog")} />
    </View>
  );
}
