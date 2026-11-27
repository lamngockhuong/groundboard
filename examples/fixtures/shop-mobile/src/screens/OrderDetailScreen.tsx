// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { useNavigation, useRoute } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Button, Text, View } from "react-native";
import { fetchOrder, type Order } from "../orders";

type Load = { state: "loading" } | { state: "failed" } | { state: "loaded"; order: Order };

export function OrderDetailScreen() {
  const navigation = useNavigation();
  const { params } = useRoute();
  const orderId = String((params as { orderId?: string })?.orderId);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const reload = () => {
    setLoad({ state: "loading" });
    fetchOrder(orderId).then(
      (order) => setLoad({ state: "loaded", order }),
      () => setLoad({ state: "failed" }),
    );
  };
  useEffect(reload, []);
  if (load.state === "loading") {
    return <ActivityIndicator accessibilityLabel="Loading the order" />;
  }
  if (load.state === "failed") {
    return (
      <View>
        <Text>The order could not be loaded.</Text>
        <Button title="Try again" onPress={reload} />
      </View>
    );
  }
  return (
    <View>
      <Text>Order {load.order.id}</Text>
      <Text>Status: {load.order.status}</Text>
      <Button title="Back to catalog" onPress={() => navigation.navigate("Catalog")} />
    </View>
  );
}
