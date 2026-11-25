// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Button, FlatList, Image, Pressable, Text, View } from "react-native";
import { type CartLine, lineTotalCents, submitOrder } from "../cart";

export function CartScreen() {
  const navigation = useNavigation();
  const [lines] = useState<CartLine[]>([]);
  const total = lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
  const onPlaceOrder = async () => {
    const { orderId } = await submitOrder(lines);
    navigation.navigate("OrderDetail", { orderId });
  };
  return (
    <View>
      <Text>Cart</Text>
      <FlatList
        data={lines}
        keyExtractor={(line) => line.sku}
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row" }}>
            <Image source={{ uri: `/images/${item.sku}.png` }} />
            <Text>{item.name}</Text>
            <Text>{lineTotalCents(item)}</Text>
          </View>
        )}
      />
      <Text>Total {total}</Text>
      <Button title="Place order" onPress={onPlaceOrder} />
      <Pressable onPress={() => navigation.navigate("Catalog")}>
        <Text>Keep shopping</Text>
      </Pressable>
    </View>
  );
}
