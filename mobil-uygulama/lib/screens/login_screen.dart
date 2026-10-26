import 'package:flutter/material.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _machineCtrl = TextEditingController(text: '001');
  final _firmaCtrl   = TextEditingController(text: 'Malta Makine');
  final _yetkiliCtrl = TextEditingController(text: 'Ahmet Yılmaz');
  final _sifreCtrl   = TextEditingController(text: '1234');
  bool _sifreGizli   = true;
  bool _yukleniyor   = false;

  Future<void> _girisYap() async {
    if (_machineCtrl.text.isEmpty ||
        _firmaCtrl.text.isEmpty ||
        _yetkiliCtrl.text.isEmpty ||
        _sifreCtrl.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Lütfen tüm alanları doldurun.')),
      );
      return;
    }

    setState(() => _yukleniyor = true);
    // Gerçekmiş gibi 1 sn bekle
    await Future.delayed(const Duration(seconds: 1));
    if (!mounted) return;
    setState(() => _yukleniyor = false);

    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => HomeScreen(
          machineNo: _machineCtrl.text.trim(),
          firma: _firmaCtrl.text.trim(),
          yetkili: _yetkiliCtrl.text.trim(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              children: [
                const Icon(Icons.inventory_2_outlined,
                    size: 72, color: Color(0xFF185FA5)),
                const SizedBox(height: 12),
                const Text('Depozito Sistemi',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                const Text('Giriş yapın',
                    style: TextStyle(fontSize: 14, color: Colors.grey)),
                const SizedBox(height: 36),

                _alan(_machineCtrl, 'Makine No', Icons.qr_code),
                const SizedBox(height: 14),
                _alan(_firmaCtrl, 'Firma Adı', Icons.business_outlined),
                const SizedBox(height: 14),
                _alan(_yetkiliCtrl, 'Yetkili İsim', Icons.person_outline),
                const SizedBox(height: 14),

                TextFormField(
                  controller: _sifreCtrl,
                  obscureText: _sifreGizli,
                  decoration: InputDecoration(
                    labelText: 'Şifre',
                    prefixIcon: const Icon(Icons.lock_outline),
                    suffixIcon: IconButton(
                      icon: Icon(_sifreGizli
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined),
                      onPressed: () =>
                          setState(() => _sifreGizli = !_sifreGizli),
                    ),
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10)),
                    filled: true,
                    fillColor: Colors.white,
                  ),
                ),
                const SizedBox(height: 28),

                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: ElevatedButton(
                    onPressed: _yukleniyor ? null : _girisYap,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF185FA5),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                    child: _yukleniyor
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Giriş Yap',
                            style: TextStyle(fontSize: 16)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _alan(TextEditingController ctrl, String label, IconData icon) {
    return TextField(
      controller: ctrl,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        filled: true,
        fillColor: Colors.white,
      ),
    );
  }
}
