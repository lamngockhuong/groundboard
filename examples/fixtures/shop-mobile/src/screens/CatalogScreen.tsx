// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { useNavigation } from "@react-navigation/native";
import { Button, Text, View } from "react-native";

export function CatalogScreen() {
  const navigation = useNavigation();
  return (
    <View>
      <Text>Catalog</Text>
      <Button title="View cart" onPress={() => navigation.navigate("Cart")} />
    </View>
  );
}
