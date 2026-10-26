import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'screens/login_screen.dart';

// ── Sahte veri state ───────────────────────────────────────────────────────
class DemoProvider extends ChangeNotifier {
  bool makineAcik = false;
  final List<bool> kapaklar = List.filled(10, false);

  void makineDegistir(bool v) {
    makineAcik = v;
    notifyListeners();
  }

  void kapakDegistir(int idx, bool v) {
    kapaklar[idx] = v;
    notifyListeners();
  }

  void tumunuAc() {
    for (int i = 0; i < 10; i++) kapaklar[i] = true;
    notifyListeners();
  }

  void tumunuKapat() {
    for (int i = 0; i < 10; i++) kapaklar[i] = false;
    notifyListeners();
  }
}

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => DemoProvider(),
      child: const DepozitoDemoApp(),
    ),
  );
}

class DepozitoDemoApp extends StatelessWidget {
  const DepozitoDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Depozito Demo',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF185FA5)),
        useMaterial3: true,
      ),
      home: const LoginScreen(),
    );
  }
}
