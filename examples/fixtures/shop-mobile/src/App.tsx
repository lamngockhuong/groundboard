// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CartScreen } from "./screens/CartScreen";
import { CatalogScreen } from "./screens/CatalogScreen";
import { OrderDetailScreen } from "./screens/OrderDetailScreen";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function Tabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Catalog" component={CatalogScreen} />
      <Tab.Screen name="Cart" component={CartScreen} />
    </Tab.Navigator>
  );
}

export function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
