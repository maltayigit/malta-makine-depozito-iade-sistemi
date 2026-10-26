import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import 'login_screen.dart';

class HomeScreen extends StatelessWidget {
  final String machineNo;
  final String firma;
  final String yetkili;

  const HomeScreen({
    super.key,
    required this.machineNo,
    required this.firma,
    required this.yetkili,
  });

  @override
  Widget build(BuildContext context) {
    final demo = context.watch<DemoProvider>();
    final acikSayisi = demo.kapaklar.where((k) => k).length;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Makine #$machineNo',
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600)),
            Text('$firma · $yetkili',
                style:
                    const TextStyle(fontSize: 12, color: Colors.grey)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Çıkış',
            onPressed: () => showDialog(
              context: context,
              builder: (_) => AlertDialog(
                title: const Text('Çıkış'),
                content:
                    const Text('Oturumu kapatmak istiyor musunuz?'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('İptal')),
                  TextButton(
                    onPressed: () {
                      Navigator.pop(context);
                      Navigator.pushReplacement(
                          context,
                          MaterialPageRoute(
                              builder: (_) => const LoginScreen()));
                    },
                    child: const Text('Çıkış Yap',
                        style: TextStyle(color: Colors.red)),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Makine kartı ──────────────────────────────────────────
          _MakineKarti(
            acik: demo.makineAcik,
            onDegistir: demo.makineDegistir,
          ),
          const SizedBox(height: 14),

          // ── Toplu işlem ───────────────────────────────────────────
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: demo.tumunuAc,
                  icon: const Icon(Icons.lock_open, size: 18),
                  label: const Text('Tümünü Aç'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF0F6E56),
                    side: const BorderSide(color: Color(0xFF0F6E56)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: demo.tumunuKapat,
                  icon: const Icon(Icons.lock_outline, size: 18),
                  label: const Text('Tümünü Kapat'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFA32D2D),
                    side: const BorderSide(color: Color(0xFFA32D2D)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // ── Kapaklar başlık ───────────────────────────────────────
          Row(
            children: [
              const Text('Kapaklar',
                  style: TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFE6F1FB),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '$acikSayisi açık',
                  style: const TextStyle(
                      fontSize: 12, color: Color(0xFF185FA5)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // ── Kapak grid ────────────────────────────────────────────
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate:
                const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              childAspectRatio: 2.4,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
            ),
            itemCount: 10,
            itemBuilder: (_, i) => _KapakKarti(
              no: i + 1,
              acik: demo.kapaklar[i],
              onTap: () => demo.kapakDegistir(i, !demo.kapaklar[i]),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Makine kartı ──────────────────────────────────────────────────────────
class _MakineKarti extends StatelessWidget {
  final bool acik;
  final ValueChanged<bool> onDegistir;
  const _MakineKarti({required this.acik, required this.onDegistir});

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: acik ? const Color(0xFFE1F5EE) : const Color(0xFFFCEBEB),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color:
              acik ? const Color(0xFF0F6E56) : const Color(0xFFA32D2D),
        ),
      ),
      child: Row(
        children: [
          Icon(
            acik ? Icons.power : Icons.power_off_outlined,
            color: acik
                ? const Color(0xFF0F6E56)
                : const Color(0xFFA32D2D),
            size: 30,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Makine Durumu',
                    style: TextStyle(fontSize: 13, color: Colors.grey)),
                Text(
                  acik ? 'AÇIK' : 'KAPALI',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: acik
                        ? const Color(0xFF0F6E56)
                        : const Color(0xFFA32D2D),
                  ),
                ),
              ],
            ),
          ),
          Switch(
            value: acik,
            onChanged: onDegistir,
            activeColor: const Color(0xFF0F6E56),
          ),
        ],
      ),
    );
  }
}

// ── Kapak kartı ───────────────────────────────────────────────────────────
class _KapakKarti extends StatelessWidget {
  final int no;
  final bool acik;
  final VoidCallback onTap;
  const _KapakKarti(
      {required this.no, required this.acik, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: acik ? const Color(0xFFE1F5EE) : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: acik
                ? const Color(0xFF0F6E56)
                : const Color(0xFFD3D1C7),
            width: acik ? 1.5 : 0.8,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 4,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: acik
                    ? const Color(0xFF1D9E75)
                    : const Color(0xFFB4B2A9),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Kapak $no',
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 13)),
                  Text(
                    acik ? 'Açık' : 'Kapalı',
                    style: TextStyle(
                      fontSize: 11,
                      color: acik
                          ? const Color(0xFF0F6E56)
                          : Colors.grey,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              acik ? Icons.lock_open : Icons.lock_outline,
              size: 18,
              color: acik ? const Color(0xFF0F6E56) : Colors.grey,
            ),
          ],
        ),
      ),
    );
  }
}
